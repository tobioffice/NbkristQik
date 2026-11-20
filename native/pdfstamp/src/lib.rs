//! Draws the library's per-reader watermark onto every page of a PDF.
//!
//! This is the native half of `src/services/library/pdf.ts`. The Node side
//! owns sessions, entitlement, the disk cache and the queue; this program
//! owns one job: read a source PDF, append the overlay to each page, write a
//! new file.
//!
//! The output must match the SVG page watermark (`watermark.ts`): the token
//! three times on a -28° diagonal at 5% opacity, and a footer naming the
//! token, the subject and the page at 42%. The ink is the same #1e2a38.
//!
//! # Why a separate process
//!
//! `pdf-lib` keeps a JavaScript object graph for the whole document, which
//! cost 9-64 MB of marginal RSS per stamp on the production VM and forced
//! the queue down to two concurrent generations. `lopdf` keeps the object
//! graph in Rust and only decompresses the page content streams it edits, so
//! the marginal cost tracks the source bytes instead of the JS heap. A
//! process boundary also means a malformed document cannot take the bot
//! down with it.
//!
//! On the development box a 100-page text PDF stamps in about 4 ms at a
//! 14 MB peak, against 39 ms warm (88 ms cold) and 65 MB of marginal memory
//! for pdf-lib. A 300-page document is about 10.5 ms at the same peak,
//! against 105 ms and 110 MB. See `docs/PDF-DELIVERY.md` for the full
//! comparison.

use lopdf::content::{Content, Operation};
use lopdf::{Dictionary, Document, Object, ObjectId};
use std::fmt;
use std::path::Path;

/// The page ink, #1e2a38, as PDF fill components.
const INK_R: f32 = 30.0 / 255.0;
const INK_G: f32 = 42.0 / 255.0;
const INK_B: f32 = 56.0 / 255.0;

/// The same weights as the SVG page stamp.
const REPEAT_OPACITY: f32 = 0.05;
const FOOTER_OPACITY: f32 = 0.42;

/// cos(-28°) and sin(-28°), the diagonal the page watermark uses.
const ROT_COS: f32 = 0.882_947_6;
const ROT_SIN: f32 = -0.469_471_57;

/// The text drawn on one page, without the page number.
#[derive(Debug, Clone, Copy)]
pub struct StampOptions<'a> {
    /// The opaque per-reader mark, e.g. `NBK-7F3A-2C19-8B44-D106`.
    pub token: &'a str,
    /// The subject code, e.g. `23CS31T2`.
    pub code: &'a str,
    /// The unit, e.g. `II`. The footer omits it when absent.
    pub unit: Option<&'a str>,
}

impl StampOptions<'_> {
    /// `NBK-… · 23CS31T2 · Unit II · p3`, or without the unit.
    fn footer(&self, page: u32) -> String {
        match self.unit.filter(|unit| !unit.is_empty()) {
            Some(unit) => format!("{} · {} · Unit {} · p{}", self.token, self.code, unit, page),
            None => format!("{} · {} · p{}", self.token, self.code, page),
        }
    }
}

/// Why a stamp failed. The CLI turns these into exit codes so the TypeScript
/// caller can keep its existing error messages.
#[derive(Debug)]
pub enum StampError {
    /// The bytes are not a PDF lopdf can read, or the page tree is unusable.
    Unreadable(String),
    /// The source is encrypted; the overlay would go into encrypted content.
    Encrypted,
    /// The output file could not be written.
    Write(String),
    /// A page has no usable resources dictionary, or the document cannot be
    /// edited in place.
    Invalid(String),
}

impl StampError {
    /// Exit status for the CLI. `3` is the one the caller maps to the
    /// "encrypted or unreadable" message; everything else is a 500.
    pub fn exit_code(&self) -> i32 {
        match self {
            Self::Unreadable(_) | Self::Encrypted => 3,
            Self::Write(_) => 4,
            Self::Invalid(_) => 1,
        }
    }
}

impl fmt::Display for StampError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unreadable(message) => write!(f, "unreadable: {message}"),
            Self::Encrypted => write!(f, "the PDF is encrypted"),
            Self::Write(message) => write!(f, "could not write the stamped PDF: {message}"),
            Self::Invalid(message) => write!(f, "invalid document: {message}"),
        }
    }
}

impl std::error::Error for StampError {}

/// Stamps `source` into `output`, returning the number of pages.
///
/// `output` is written directly. The caller gives a temporary path and
/// renames it into place, so a crash never leaves a half-written cache file
/// under its final name.
pub fn stamp_file(
    source: &Path,
    output: &Path,
    options: &StampOptions<'_>,
) -> Result<usize, StampError> {
    let mut document =
        Document::load(source).map_err(|error| StampError::Unreadable(error.to_string()))?;

    if document.is_encrypted() {
        return Err(StampError::Encrypted);
    }

    // One font and two alpha states serve every page. Standard-14
    // Helvetica-Bold is not embedded, exactly as pdf-lib drew it: the PDF
    // viewer supplies the face, so the output stays small.
    let font_id = add_font(&mut document);
    let repeat_state = add_alpha_state(&mut document, REPEAT_OPACITY);
    let footer_state = add_alpha_state(&mut document, FOOTER_OPACITY);

    let pages: Vec<(u32, ObjectId)> = document.get_pages().into_iter().collect();
    if pages.is_empty() {
        return Err(StampError::Unreadable("the PDF has no pages".into()));
    }

    for (page_number, page_id) in &pages {
        let (width, height) = page_size(&document, *page_id);
        let names =
            install_resources(&mut document, *page_id, font_id, repeat_state, footer_state)?;
        let content = page_overlay(
            width,
            height,
            options,
            *page_number,
            &names.font,
            &names.repeat_state,
            &names.footer_state,
        );
        document
            .add_to_page_content(*page_id, content)
            .map_err(|error| StampError::Invalid(error.to_string()))?;
    }

    document
        .save(output)
        .map_err(|error| StampError::Write(error.to_string()))?;

    Ok(pages.len())
}

/// The three resource names a page's content stream refers to. They are
/// chosen per page because a source may already use the obvious names.
struct ResourceNames {
    font: Vec<u8>,
    repeat_state: Vec<u8>,
    footer_state: Vec<u8>,
}

fn add_font(document: &mut Document) -> ObjectId {
    let mut font = Dictionary::new();
    font.set("Type", "Font");
    font.set("Subtype", "Type1");
    font.set("BaseFont", "Helvetica-Bold");
    font.set("Encoding", "WinAnsiEncoding");
    document.add_object(font)
}

fn add_alpha_state(document: &mut Document, opacity: f32) -> ObjectId {
    let mut state = Dictionary::new();
    state.set("Type", "ExtGState");
    // `ca` is non-stroking alpha; text is filled, so that is the one that
    // matters. `CA` keeps the pair complete for any stroked fallback.
    state.set("ca", opacity);
    state.set("CA", opacity);
    document.add_object(state)
}

/// Adds the font and alpha states to this page's own resource dictionary,
/// preserving whatever it inherited or referenced.
///
/// A page may have `/Resources` as a direct dictionary, a reference on the
/// page, or on an ancestor. The nearest one wins (ISO 32000-1 §7.7.3.4), so
/// the base is the nearest direct dictionary, else the first reference in
/// the chain. The result is written as a direct dictionary on the page: a
/// small copy per page is cheaper than reasoning about one shared dictionary
/// that must not be mutated under other pages.
fn install_resources(
    document: &mut Document,
    page_id: ObjectId,
    font_id: ObjectId,
    repeat_state: ObjectId,
    footer_state: ObjectId,
) -> Result<ResourceNames, StampError> {
    let mut resources = base_resources(document, page_id);

    let mut fonts = child_dictionary(document, &resources, b"Font");
    let font = unique_name(&fonts, "NbkQikFnt");
    fonts.set(font.clone(), Object::Reference(font_id));

    let mut states = child_dictionary(document, &resources, b"ExtGState");
    let repeat = unique_name(&states, "NbkQikRpt");
    states.set(repeat.clone(), Object::Reference(repeat_state));
    let footer = unique_name(&states, "NbkQikFtr");
    states.set(footer.clone(), Object::Reference(footer_state));

    resources.set("Font", fonts);
    resources.set("ExtGState", states);

    let page = document
        .get_object_mut(page_id)
        .and_then(Object::as_dict_mut)
        .map_err(|error| StampError::Invalid(error.to_string()))?;
    page.set("Resources", resources);

    Ok(ResourceNames {
        font,
        repeat_state: repeat,
        footer_state: footer,
    })
}

/// The nearest `/Resources`, cloned so it can be edited for one page.
fn base_resources(document: &Document, page_id: ObjectId) -> Dictionary {
    if let Ok((direct, references)) = document.get_page_resources(page_id) {
        if let Some(resources) = direct {
            return resources.clone();
        }
        if let Some(id) = references.first() {
            if let Ok(resources) = document.get_dictionary(*id) {
                return resources.clone();
            }
        }
    }
    Dictionary::new()
}

/// A category dictionary (`/Font`, `/ExtGState`) as an owned copy. The
/// category itself may be a reference, which is common in real documents.
fn child_dictionary(document: &Document, resources: &Dictionary, key: &[u8]) -> Dictionary {
    match resources.get(key) {
        Ok(Object::Dictionary(dictionary)) => dictionary.clone(),
        Ok(Object::Reference(id)) => document.get_dictionary(*id).cloned().unwrap_or_default(),
        _ => Dictionary::new(),
    }
}

/// A resource name that is not already used in this category.
fn unique_name(dictionary: &Dictionary, base: &str) -> Vec<u8> {
    if !dictionary.has(base.as_bytes()) {
        return base.as_bytes().to_vec();
    }
    for suffix in 1..1000 {
        let candidate = format!("{base}{suffix}");
        if !dictionary.has(candidate.as_bytes()) {
            return candidate.into_bytes();
        }
    }
    format!("{base}Extra").into_bytes()
}

/// The page size from the nearest `/MediaBox` in the page tree.
///
/// pdf-lib's `page.getSize()` uses the unrotated MediaBox and does not
/// subtract its lower-left corner, so this matches the previous output for
/// the ordinary `[0 0 w h]` case. A missing or malformed box falls back to
/// A4, the format every document on the shelf uses.
fn page_size(document: &Document, page_id: ObjectId) -> (f32, f32) {
    let media_box = inherited(document, page_id, b"MediaBox")
        .and_then(|object| resolved(document, object))
        .and_then(|object| object.as_array().ok());

    if let Some(values) = media_box {
        let numbers: Vec<f32> = values.iter().filter_map(as_number).collect();
        if numbers.len() >= 4 {
            let width = numbers[2] - numbers[0];
            let height = numbers[3] - numbers[1];
            if width > 1.0 && height > 1.0 {
                return (width, height);
            }
        }
    }

    (595.0, 842.0)
}

/// Walks `/Parent` from the page to find an inheritable entry.
fn inherited<'a>(document: &'a Document, page_id: ObjectId, key: &[u8]) -> Option<&'a Object> {
    let mut current = Some(page_id);
    let mut depth = 0;

    while let Some(id) = current {
        if depth > 64 {
            return None;
        }
        let dictionary = document.get_dictionary(id).ok()?;
        if let Ok(value) = dictionary.get(key) {
            return Some(value);
        }
        current = dictionary
            .get(b"Parent")
            .and_then(Object::as_reference)
            .ok();
        depth += 1;
    }

    None
}

fn resolved<'a>(document: &'a Document, object: &'a Object) -> Option<&'a Object> {
    match object {
        Object::Reference(id) => document.get_object(*id).ok(),
        other => Some(other),
    }
}

fn as_number(object: &Object) -> Option<f32> {
    match object {
        Object::Integer(value) => Some(*value as f32),
        Object::Real(value) => Some(*value),
        _ => None,
    }
}

/// The overlay for one page: three diagonal token rows and the footer.
fn page_overlay(
    width: f32,
    height: f32,
    options: &StampOptions<'_>,
    page: u32,
    font: &[u8],
    repeat_state: &[u8],
    footer_state: &[u8],
) -> Content {
    let repeat_size = (width / 36.0).round().max(8.0);
    let footer_size = (width / 52.0).round().max(7.0);
    let step = (height / 3.2).round();
    let ink = [INK_R, INK_G, INK_B];

    let mut operations = Vec::with_capacity(4 + 3 * 9 + 10);
    // One balanced q/Q around the whole overlay. The source keeps its own
    // graphics state: appending a stream does not disturb it, and an extra
    // `Q` on an empty stack makes poppler log a syntax error even though the
    // specification calls it a no-op.
    operations.push(operation("q", vec![]));

    for row in 0..3 {
        let x = -height * 0.12;
        let y = step * (row as f32 + 0.8);
        operations.push(operation("q", vec![]));
        operations.push(operation("gs", vec![Object::Name(repeat_state.to_vec())]));
        operations.push(operation(
            "rg",
            vec![
                Object::Real(ink[0]),
                Object::Real(ink[1]),
                Object::Real(ink[2]),
            ],
        ));
        operations.push(operation("BT", vec![]));
        operations.push(operation(
            "Tf",
            vec![Object::Name(font.to_vec()), Object::Real(repeat_size)],
        ));
        // [cos sin -sin cos x y]: the same -28° rotation pdf-lib applied.
        operations.push(operation(
            "Tm",
            vec![
                Object::Real(ROT_COS),
                Object::Real(ROT_SIN),
                Object::Real(-ROT_SIN),
                Object::Real(ROT_COS),
                Object::Real(x),
                Object::Real(y),
            ],
        ));
        operations.push(operation("Tj", vec![text(options.token)]));
        operations.push(operation("ET", vec![]));
        operations.push(operation("Q", vec![]));
    }

    operations.push(operation("q", vec![]));
    operations.push(operation("gs", vec![Object::Name(footer_state.to_vec())]));
    operations.push(operation(
        "rg",
        vec![
            Object::Real(ink[0]),
            Object::Real(ink[1]),
            Object::Real(ink[2]),
        ],
    ));
    operations.push(operation("BT", vec![]));
    operations.push(operation(
        "Tf",
        vec![Object::Name(font.to_vec()), Object::Real(footer_size)],
    ));
    operations.push(operation(
        "Tm",
        vec![
            Object::Real(1.0),
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(1.0),
            Object::Real((width * 0.03).round()),
            Object::Real((height * 0.02).round()),
        ],
    ));
    operations.push(operation("Tj", vec![text(&options.footer(page))]));
    operations.push(operation("ET", vec![]));
    operations.push(operation("Q", vec![]));

    operations.push(operation("Q", vec![]));

    Content { operations }
}

fn operation(operator: &str, operands: Vec<Object>) -> Operation {
    Operation::new(operator, operands)
}

/// A literal text object in WinAnsiEncoding.
fn text(value: &str) -> Object {
    Object::String(win_ansi(value), lopdf::StringFormat::Literal)
}

/// Encodes the characters the footer can contain.
///
/// Helvetica with WinAnsiEncoding covers ASCII and the punctuation the
/// library uses. Anything else becomes `?`: a stray glyph must never break
/// the content stream or smuggle a PDF operator into the text.
fn win_ansi(value: &str) -> Vec<u8> {
    value
        .chars()
        .map(|character| match character {
            character if character.is_ascii() => character as u8,
            '\u{00b7}' => 0xb7, // · middle dot
            '\u{2013}' => 0x96, // – en dash
            '\u{2014}' => 0x97, // — em dash
            '\u{2018}' => 0x91, // ‘
            '\u{2019}' => 0x92, // ’
            '\u{201c}' => 0x93, // “
            '\u{201d}' => 0x94, // ”
            _ => b'?',
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> StampOptions<'static> {
        StampOptions {
            token: "NBK-AAAA-BBBB-CCCC-DDDD",
            code: "23CS31T2",
            unit: Some("II"),
        }
    }

    #[test]
    fn the_footer_names_the_token_subject_unit_and_page() {
        assert_eq!(
            options().footer(3),
            "NBK-AAAA-BBBB-CCCC-DDDD · 23CS31T2 · Unit II · p3"
        );
    }

    #[test]
    fn the_footer_omits_an_empty_unit() {
        let options = StampOptions {
            unit: None,
            ..options()
        };
        assert_eq!(options.footer(1), "NBK-AAAA-BBBB-CCCC-DDDD · 23CS31T2 · p1");
    }

    #[test]
    fn the_overlay_draws_the_token_three_times_and_the_footer_once() {
        let content = page_overlay(595.0, 842.0, &options(), 2, b"F", b"R", b"D");
        let encoded = String::from_utf8_lossy(&content.encode().unwrap()).to_string();

        assert_eq!(encoded.matches(options().token).count(), 4);
        assert!(encoded.contains("p2"));
        assert!(encoded.contains("/R gs"));
        assert!(encoded.contains("/D gs"));
    }

    #[test]
    fn the_repeat_uses_the_same_geometry_as_the_previous_stamper() {
        let content = page_overlay(595.0, 842.0, &options(), 1, b"F", b"R", b"D");
        let text_matrix = content
            .operations
            .iter()
            .find(|operation| operation.operator == "Tm")
            .unwrap();

        let values: Vec<f32> = text_matrix.operands.iter().filter_map(as_number).collect();

        // cos, sin, -sin, cos, -height*0.12, round(height/3.2)*0.8
        assert!((values[0] - 0.882_947_6).abs() < 1e-5);
        assert!((values[1] + 0.469_471_57).abs() < 1e-5);
        assert!((values[2] - 0.469_471_57).abs() < 1e-5);
        assert!((values[3] - 0.882_947_6).abs() < 1e-5);
        assert!((values[4] + 101.04).abs() < 0.01);
        assert!((values[5] - 210.4).abs() < 0.01);
    }

    #[test]
    fn the_footer_sits_at_the_bottom_left_of_the_media_box() {
        let content = page_overlay(595.0, 842.0, &options(), 1, b"F", b"R", b"D");
        let footer_matrix = content
            .operations
            .iter()
            .filter(|operation| operation.operator == "Tm")
            .nth(3)
            .unwrap();
        let values: Vec<f32> = footer_matrix
            .operands
            .iter()
            .filter_map(as_number)
            .collect();

        assert_eq!(values[4], 18.0); // round(595 * 0.03)
        assert_eq!(values[5], 17.0); // round(842 * 0.02)
    }

    #[test]
    fn a_used_resource_name_gets_a_suffix() {
        let mut dictionary = Dictionary::new();
        assert_eq!(unique_name(&dictionary, "NbkQikFnt"), b"NbkQikFnt");
        dictionary.set("NbkQikFnt", Object::Null);
        assert_eq!(unique_name(&dictionary, "NbkQikFnt"), b"NbkQikFnt1");
    }

    #[test]
    fn win_ansi_maps_the_middle_dot_and_replaces_unknown_glyphs() {
        assert_eq!(win_ansi("a·b"), b"a\xb7b");
        assert_eq!(win_ansi("a\u{4e2d}b"), b"a?b");
    }
}
