//! CLI for the library's PDF stamp.
//!
//!     pdfstamp --in <source.pdf> --out <stamped.pdf> \
//!              --token NBK-… --code 23CS31T2 [--unit II]
//!
//! The caller owns the output path (usually a temporary file it renames into
//! place) and every user-facing message. Success is silent; failures go to
//! stderr with an exit code that says whether the source was unreadable.

use std::path::PathBuf;
use std::process::ExitCode;

use pdfstamp::{stamp_file, StampError, StampOptions};

const USAGE: &str = "\
usage: pdfstamp --in <source.pdf> --out <stamped.pdf> --token <token> --code <code> [--unit <unit>]

Writes a copy of the source with the library watermark on every page.";

#[derive(Debug)]
struct Args {
    input: PathBuf,
    output: PathBuf,
    token: String,
    code: String,
    unit: Option<String>,
}

fn main() -> ExitCode {
    match parse(std::env::args().skip(1)) {
        Ok(Some(args)) => match run(args) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("pdfstamp: {error}");
                ExitCode::from(error.exit_code() as u8)
            }
        },
        Ok(None) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("pdfstamp: {message}\n\n{USAGE}");
            ExitCode::from(2)
        }
    }
}

fn run(args: Args) -> Result<(), StampError> {
    let options = StampOptions {
        token: &args.token,
        code: &args.code,
        unit: args.unit.as_deref(),
    };
    stamp_file(&args.input, &args.output, &options).map(|_| ())
}

/// `Ok(None)` means help or version was printed.
fn parse(mut arguments: impl Iterator<Item = String>) -> Result<Option<Args>, String> {
    let mut input = None;
    let mut output = None;
    let mut token = None;
    let mut code = None;
    let mut unit = None;

    while let Some(argument) = arguments.next() {
        let (flag, inline) = match argument.split_once('=') {
            Some((flag, value)) => (flag, Some(value.to_string())),
            None => (argument.as_str(), None),
        };

        match flag {
            "--help" | "-h" => {
                println!("{USAGE}");
                return Ok(None);
            }
            "--version" | "-V" => {
                println!("pdfstamp {}", env!("CARGO_PKG_VERSION"));
                return Ok(None);
            }
            "--in" => input = Some(PathBuf::from(value(inline, &mut arguments, "--in")?)),
            "--out" => output = Some(PathBuf::from(value(inline, &mut arguments, "--out")?)),
            "--token" => token = Some(value(inline, &mut arguments, "--token")?),
            "--code" => code = Some(value(inline, &mut arguments, "--code")?),
            "--unit" => unit = Some(value(inline, &mut arguments, "--unit")?),
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    Ok(Some(Args {
        input: input.ok_or("missing --in")?,
        output: output.ok_or("missing --out")?,
        token: token.ok_or("missing --token")?,
        code: code.ok_or("missing --code")?,
        unit,
    }))
}

fn value(
    inline: Option<String>,
    arguments: &mut impl Iterator<Item = String>,
    name: &str,
) -> Result<String, String> {
    inline
        .or_else(|| arguments.next())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{name} needs a value"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Result<Option<Args>, String> {
        parse(values.iter().map(|value| value.to_string()))
    }

    #[test]
    fn parses_both_flag_shapes() {
        let parsed = args(&[
            "--in",
            "a.pdf",
            "--out=b.pdf",
            "--token",
            "NBK-AAAA-BBBB-CCCC-DDDD",
            "--code",
            "23CS31T2",
            "--unit",
            "II",
        ])
        .unwrap()
        .unwrap();

        assert_eq!(parsed.input, PathBuf::from("a.pdf"));
        assert_eq!(parsed.output, PathBuf::from("b.pdf"));
        assert_eq!(parsed.unit.as_deref(), Some("II"));
    }

    #[test]
    fn rejects_an_unknown_flag_and_a_missing_value() {
        assert!(args(&["--nope"]).is_err());
        assert!(args(&["--in"]).is_err());
    }

    #[test]
    fn requires_the_four_essential_flags() {
        let error = args(&["--in", "a.pdf"]).unwrap_err();
        assert!(error.contains("--out"));
    }
}
