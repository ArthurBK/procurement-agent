import { parse as parseCsv } from "csv-parse/sync";
import { read, utils } from "xlsx";

export type ParsedTransactionPreview = {
  rowNumber: number;
  date: string | null;
  rawSupplier: string;
  amountCents: number | null;
  currency: string;
  bankAccount: string | null;
  description: string | null;
  sourceRow: Record<string, unknown>;
};

export type ParsedTransactionPreviewResult = {
  columns: string[];
  rows: ParsedTransactionPreview[];
  errors: string[];
};

type SourceRecord = Record<string, unknown>;

type ParsedSourceRows = {
  columns: string[];
  rows: Array<{
    rowNumber: number;
    sourceRow: SourceRecord;
  }>;
  date1904: boolean;
};

type TransactionColumn =
  | "date"
  | "rawSupplier"
  | "amount"
  | "currency"
  | "bankAccount"
  | "description";

const ACCOUNTING_COLUMN_ALIASES: Record<TransactionColumn, readonly string[]> = {
  date: [
    "Date",
    "Operation date (local)",
    "Operation date (UTC)",
    "Settlement date (local)",
    "Settlement date (UTC)",
  ],
  rawSupplier: ["Libellé", "Counterparty name", "Tiers"],
  amount: [
    "Montant",
    "Total amount (incl. VAT)",
    "Total amount (incl. VAT) (local)",
  ],
  currency: ["Currency", "Currency (local)"],
  bankAccount: ["Compte Bancaire", "Account name", "Account IBAN", "Bank"],
  description: ["Commentaires", "Note", "Reference"],
} as const;

export function parseAccountingFile(
  fileBuffer: Buffer,
  fileName: string,
): ParsedTransactionPreviewResult {
  const extension = getFileExtension(fileName);

  if (![".csv", ".xlsx", ".xls"].includes(extension)) {
    return {
      columns: [],
      rows: [],
      errors: ["Unsupported file type. Upload a CSV, XLSX, or XLS file."],
    };
  }

  let parsedRows: ParsedSourceRows;

  try {
    parsedRows =
      extension === ".csv"
        ? parseCsvFile(fileBuffer)
        : parseSpreadsheetFile(fileBuffer);
  } catch (error) {
    return {
      columns: [],
      rows: [],
      errors: [`Unable to parse file: ${getErrorMessage(error)}`],
    };
  }

  const errors: string[] = [];
  const mappedColumns = {
    date: findColumns(parsedRows.columns, ACCOUNTING_COLUMN_ALIASES.date),
    rawSupplier: findColumns(
      parsedRows.columns,
      ACCOUNTING_COLUMN_ALIASES.rawSupplier,
    ),
    amount: findColumns(parsedRows.columns, ACCOUNTING_COLUMN_ALIASES.amount),
    currency: findColumns(parsedRows.columns, ACCOUNTING_COLUMN_ALIASES.currency),
    bankAccount: findColumns(
      parsedRows.columns,
      ACCOUNTING_COLUMN_ALIASES.bankAccount,
    ),
    description: findColumns(
      parsedRows.columns,
      ACCOUNTING_COLUMN_ALIASES.description,
    ),
  };

  const rows = parsedRows.rows.map(({ rowNumber, sourceRow }) => {
    const amountValue = readFirstColumnValue(sourceRow, mappedColumns.amount);
    const parsedDate = parseDateValue(
      readFirstColumnValue(sourceRow, mappedColumns.date),
      parsedRows.date1904,
    );
    const amountCents = parseAmountCents(amountValue);

    if (parsedDate.error) {
      errors.push(`Row ${rowNumber}: ${parsedDate.error}`);
    }

    if (amountCents === null) {
      errors.push(
        `Row ${rowNumber}: Invalid Montant value "${formatRawValue(
          amountValue,
        )}".`,
      );
    }

    return {
      rowNumber,
      date: parsedDate.value,
      rawSupplier:
        toStringValue(readFirstColumnValue(sourceRow, mappedColumns.rawSupplier)) ??
        "",
      amountCents,
      currency:
        toStringValue(readFirstColumnValue(sourceRow, mappedColumns.currency)) ??
        "EUR",
      bankAccount: toStringValue(
        readFirstColumnValue(sourceRow, mappedColumns.bankAccount),
      ),
      description: toStringValue(
        readFirstColumnValue(sourceRow, mappedColumns.description),
      ),
      sourceRow,
    };
  });

  return {
    columns: parsedRows.columns,
    rows,
    errors,
  };
}

function parseCsvFile(fileBuffer: Buffer): ParsedSourceRows {
  const content = fileBuffer.toString("utf8");
  const records = parseCsv(content, {
    bom: true,
    delimiter: detectCsvDelimiter(content),
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as unknown[][];

  if (records.length === 0) {
    return {
      columns: [],
      rows: [],
      date1904: false,
    };
  }

  const columns = buildColumns(records[0]);
  const rows = records.slice(1).map((record, index) => ({
    rowNumber: index + 2,
    sourceRow: buildSourceRow(columns, record),
  }));

  return {
    columns,
    rows: rows.filter(({ sourceRow }) => !isEmptySourceRow(sourceRow)),
    date1904: false,
  };
}

function parseSpreadsheetFile(fileBuffer: Buffer): ParsedSourceRows {
  const workbook = read(fileBuffer, {
    cellDates: false,
    type: "buffer",
  });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return {
      columns: [],
      rows: [],
      date1904: Boolean(workbook.Workbook?.WBProps?.date1904),
    };
  }

  const sheet = workbook.Sheets[firstSheetName];
  const records = utils.sheet_to_json<unknown[]>(sheet, {
    blankrows: false,
    defval: null,
    header: 1,
    raw: true,
  });
  const headerIndex = records.findIndex((record) =>
    record.some((value) => !isBlank(value)),
  );

  if (headerIndex === -1) {
    return {
      columns: [],
      rows: [],
      date1904: Boolean(workbook.Workbook?.WBProps?.date1904),
    };
  }

  const columns = buildColumns(records[headerIndex]);
  const rows = records.slice(headerIndex + 1).map((record, index) => ({
    rowNumber: headerIndex + index + 2,
    sourceRow: buildSourceRow(columns, record),
  }));

  return {
    columns,
    rows: rows.filter(({ sourceRow }) => !isEmptySourceRow(sourceRow)),
    date1904: Boolean(workbook.Workbook?.WBProps?.date1904),
  };
}

function buildColumns(headerRow: unknown[]): string[] {
  return headerRow.map((value, index) => {
    const columnName = toStringValue(value);

    return columnName ?? `Column ${index + 1}`;
  });
}

function buildSourceRow(columns: string[], record: unknown[]): SourceRecord {
  return columns.reduce<SourceRecord>((sourceRow, column, index) => {
    sourceRow[column] = record[index] ?? null;
    return sourceRow;
  }, {});
}

function detectCsvDelimiter(content: string): string {
  const firstLine =
    content
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.replace(/^\uFEFF/, "") ?? "";
  const delimiters = [",", ";", "\t"];

  return delimiters.reduce((bestDelimiter, delimiter) => {
    const bestCount = firstLine.split(bestDelimiter).length;
    const count = firstLine.split(delimiter).length;

    return count > bestCount ? delimiter : bestDelimiter;
  }, ",");
}

function findColumns(
  columns: string[],
  expectedColumns: readonly string[],
): string[] {
  const columnsByNormalizedName = new Map(
    columns.map((column) => [normalizeColumnName(column), column]),
  );

  return expectedColumns.flatMap((expectedColumn) => {
    const column = columnsByNormalizedName.get(normalizeColumnName(expectedColumn));

    return column ? [column] : [];
  });
}

function normalizeColumnName(column: string): string {
  return column.replace(/^\uFEFF/, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function readFirstColumnValue(
  sourceRow: SourceRecord,
  columns: readonly string[],
): unknown {
  for (const column of columns) {
    const value = sourceRow[column];

    if (!isBlank(value)) {
      return value;
    }
  }

  return null;
}

function parseDateValue(
  value: unknown,
  date1904: boolean,
): { value: string | null; error: string | null } {
  if (isBlank(value)) {
    return { value: null, error: null };
  }

  if (typeof value === "number") {
    const isoDate = excelSerialDateToIsoDate(value, date1904);

    return isoDate
      ? { value: isoDate, error: null }
      : {
          value: null,
          error: `Invalid Date value "${formatRawValue(value)}".`,
        };
  }

  if (value instanceof Date) {
    const isoDate = datePartsToIsoDate(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
    );

    return isoDate
      ? { value: isoDate, error: null }
      : {
          value: null,
          error: `Invalid Date value "${formatRawValue(value)}".`,
        };
  }

  if (typeof value === "string") {
    const isoDate = parseDateString(value);

    return isoDate
      ? { value: isoDate, error: null }
      : {
          value: null,
          error: `Invalid Date value "${formatRawValue(value)}".`,
        };
  }

  return {
    value: null,
    error: `Invalid Date value "${formatRawValue(value)}".`,
  };
}

function excelSerialDateToIsoDate(
  serialDate: number,
  date1904: boolean,
): string | null {
  if (!Number.isFinite(serialDate)) {
    return null;
  }

  const wholeDays = Math.floor(serialDate);

  if (wholeDays < 0 || (!date1904 && wholeDays === 60)) {
    return null;
  }

  const utcDate = date1904
    ? new Date(Date.UTC(1904, 0, 1 + wholeDays))
    : new Date(Date.UTC(1899, 11, 31 + wholeDays - (wholeDays > 60 ? 1 : 0)));

  return datePartsToIsoDate(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth() + 1,
    utcDate.getUTCDate(),
  );
}

function parseDateString(value: string): string | null {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  const isoMatch = trimmedValue.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);

  if (isoMatch) {
    return datePartsToIsoDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  const yearFirstMatch = trimmedValue.match(
    /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:[T\s].*)?$/,
  );

  if (yearFirstMatch) {
    return datePartsToIsoDate(
      Number(yearFirstMatch[1]),
      Number(yearFirstMatch[2]),
      Number(yearFirstMatch[3]),
    );
  }

  const dayFirstMatch = trimmedValue.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:[T\s].*)?$/,
  );

  if (dayFirstMatch) {
    return datePartsToIsoDate(
      normalizeYear(Number(dayFirstMatch[3])),
      Number(dayFirstMatch[2]),
      Number(dayFirstMatch[1]),
    );
  }

  return null;
}

function normalizeYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

function datePartsToIsoDate(
  year: number,
  month: number,
  day: number,
): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function parseAmountCents(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedAmount = normalizeAmountString(value);

  if (!normalizedAmount) {
    return null;
  }

  const amount = Number(normalizedAmount);

  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function normalizeAmountString(value: string): string | null {
  let amount = value.trim();

  if (amount.length === 0) {
    return null;
  }

  let isNegative = false;

  if (amount.startsWith("(") && amount.endsWith(")")) {
    isNegative = true;
    amount = amount.slice(1, -1);
  }

  amount = amount
    .replace(/[\s\u00A0\u202F]/g, "")
    .replace(/[€$£A-Za-z]/g, "");

  if (amount.startsWith("-")) {
    isNegative = true;
    amount = amount.slice(1);
  }

  if (amount.endsWith("-")) {
    isNegative = true;
    amount = amount.slice(0, -1);
  }

  if (amount.startsWith("+")) {
    amount = amount.slice(1);
  }

  amount = amount.replace(/'/g, "");

  if (!/^\d[\d.,]*$/.test(amount)) {
    return null;
  }

  const decimalSeparator = getDecimalSeparator(amount);

  if (decimalSeparator) {
    const separatorIndex = amount.lastIndexOf(decimalSeparator);
    const integerPart = amount
      .slice(0, separatorIndex)
      .replace(/[.,]/g, "");
    const decimalPart = amount
      .slice(separatorIndex + 1)
      .replace(/[.,]/g, "");

    amount = `${integerPart}.${decimalPart}`;
  } else {
    amount = amount.replace(/[.,]/g, "");
  }

  if (!/^\d+(\.\d+)?$/.test(amount)) {
    return null;
  }

  return `${isNegative ? "-" : ""}${amount}`;
}

function getDecimalSeparator(value: string): "." | "," | null {
  const lastCommaIndex = value.lastIndexOf(",");
  const lastDotIndex = value.lastIndexOf(".");

  if (lastCommaIndex !== -1 && lastDotIndex !== -1) {
    return lastCommaIndex > lastDotIndex ? "," : ".";
  }

  if (lastCommaIndex !== -1) {
    return hasDecimalPart(value, ",") ? "," : null;
  }

  if (lastDotIndex !== -1) {
    return hasDecimalPart(value, ".") ? "." : null;
  }

  return null;
}

function hasDecimalPart(value: string, separator: "." | ","): boolean {
  const parts = value.split(separator);

  return parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2;
}

function toStringValue(value: unknown): string | null {
  if (isBlank(value)) {
    return null;
  }

  return String(value).trim();
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function isEmptySourceRow(sourceRow: SourceRecord): boolean {
  return Object.values(sourceRow).every(isBlank);
}

function getFileExtension(fileName: string): string {
  const extensionStartIndex = fileName.lastIndexOf(".");

  return extensionStartIndex === -1
    ? ""
    : fileName.slice(extensionStartIndex).toLowerCase();
}

function formatRawValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
