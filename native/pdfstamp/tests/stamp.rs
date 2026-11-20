//! Stamping a real PDF, and failing cleanly on a bad one.

use std::fs;
use std::path::{Path, PathBuf};

use lopdf::dictionary;
use lopdf::Document;
use pdfstamp::{stamp_file, StampError, StampOptions};

const TOKEN: &str = "NBK-AAAA-BBBB-CCCC-DDDD";

fn scratch(name: &str) -> PathBuf {
    let directory =
        std::env::temp_dir().join(format!("pdfstamp-test-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).unwrap();
    directory
}

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/two-pages.pdf")
}

fn options() -> StampOptions<'static> {
    StampOptions {
        token: TOKEN,
        code: "23CS31T2",
        unit: Some("II"),
    }
}

#[test]
fn stamps_every_page_and_leaves_the_page_count_alone() {
    let directory = scratch("stamp");
    let output = directory.join("stamped.pdf");

    let pages = stamp_file(&fixture(), &output, &options()).unwrap();
    assert_eq!(pages, 2);

    let document = Document::load(&output).unwrap();
    let page_ids: Vec<_> = document.get_pages().into_values().collect();
    assert_eq!(page_ids.len(), 2);

    for (index, page_id) in page_ids.iter().enumerate() {
        let content = document.get_page_content(*page_id);
        let content = String::from_utf8_lossy(&content);

        // three diagonal rows and one footer, each carrying the token
        assert_eq!(content.matches(TOKEN).count(), 4);
        assert!(content.contains(&format!("p{}", index + 1)));
        assert!(content.contains("23CS31T2"));
        assert!(content.contains("Unit II"));

        let resources = document.get_page_resources(*page_id).unwrap().0.unwrap();
        let fonts = resources.get(b"Font").unwrap().as_dict().unwrap();
        assert!(fonts.iter().any(|(_, font)| {
            document
                .get_object(font.as_reference().unwrap())
                .ok()
                .and_then(|object| object.as_dict().ok())
                .and_then(|font| font.get(b"BaseFont").ok())
                .and_then(|name| name.as_name().ok())
                == Some(b"Helvetica-Bold")
        }));

        let states = resources.get(b"ExtGState").unwrap().as_dict().unwrap();
        assert_eq!(states.len(), 2);
    }

    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn keeps_the_source_content_stream_before_the_overlay() {
    let directory = scratch("order");
    let output = directory.join("stamped.pdf");
    stamp_file(&fixture(), &output, &options()).unwrap();

    let source = Document::load(fixture()).unwrap();
    let source_page = source.get_pages().into_values().next().unwrap();
    let source_content = source.get_page_content(source_page);

    let document = Document::load(&output).unwrap();
    let page_id = document.get_pages().into_values().next().unwrap();
    let content = document.get_page_content(page_id);

    // The overlay is appended, so the source bytes come first unchanged.
    assert!(content.starts_with(&source_content));
    assert!(String::from_utf8_lossy(&content).contains(TOKEN));

    // One balanced q/Q wraps the overlay, so the viewer's graphics state is
    // exactly where the source left it.
    let overlay = String::from_utf8_lossy(&content[source_content.len()..]).to_string();
    assert!(overlay.trim_start_matches('\n').starts_with("q\n"));
    assert!(overlay.trim_end_matches('\n').ends_with('Q'));

    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn refuses_a_file_that_is_not_a_pdf() {
    let directory = scratch("garbage");
    let source = directory.join("bad.pdf");
    let output = directory.join("stamped.pdf");
    fs::write(&source, b"this is not a pdf").unwrap();

    let error = stamp_file(&source, &output, &options()).unwrap_err();
    assert!(matches!(error, StampError::Unreadable(_)), "{error:?}");
    assert_eq!(error.exit_code(), 3);

    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn an_encrypted_document_is_refused_before_it_is_edited() {
    let directory = scratch("encrypted");
    let source = directory.join("encrypted.pdf");
    let output = directory.join("stamped.pdf");

    // Build a document whose trailer points at an encryption dictionary.
    // lopdf needs no valid password to parse it; the guard must refuse it
    // before any overlay is written into encrypted content.
    let mut document = Document::with_version("1.5");
    let encryption = document.add_object(dictionary! {
        "Filter" => "Standard",
        "V" => 1_u8,
        "R" => 2_u8,
        "O" => lopdf::Object::String(vec![0; 32], lopdf::StringFormat::Literal),
        "U" => lopdf::Object::String(vec![0; 32], lopdf::StringFormat::Literal),
        "P" => -4_i8,
    });
    document.trailer.set("Encrypt", encryption);
    document.save(&source).unwrap();

    let error = stamp_file(&source, &output, &options()).unwrap_err();
    assert!(matches!(error, StampError::Encrypted), "{error:?}");
    assert!(!output.exists());

    fs::remove_dir_all(directory).unwrap();
}
