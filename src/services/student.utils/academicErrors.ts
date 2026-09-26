// Custom error classes for the academic scraping flow
export class AcademicError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "AcademicError";
  }
}

export class ServerDownError extends AcademicError {
  constructor() {
    super(
      "College server is not responding. Please try again later.",
      "SERVER_DOWN",
    );
  }
}

export class BlockedReportError extends AcademicError {
  constructor() {
    super("Report is blocked by the Admin.", "REPORT_BLOCKED");
  }
}

export class NoDataFoundError extends AcademicError {
  constructor(type: "attendance" | "midmarks") {
    super(`No ${type} data found for this roll number.`, "NO_DATA");
  }
}

export class InvalidCredentialsError extends AcademicError {
  constructor() {
    super("Invalid credentials. Please contact admin.", "INVALID_CREDENTIALS");
  }
}
