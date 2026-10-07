/**
 * CSV cell escaping. Cells starting with = + - @ (or tab/CR) are prefixed with an
 * apostrophe: spreadsheet apps would otherwise run them as formulas, and product
 * names and addresses come from users.
 */
export const csvCell = (value) => {
    if (value === null || value === undefined) return ""
    let text = value instanceof Date ? value.toISOString() : String(value)
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const csvRow = (values) => values.map(csvCell).join(",")

/** Header row + data rows, CRLF line endings (what Excel expects). */
export const toCsv = (header, rows) => [csvRow(header), ...rows.map(csvRow)].join("\r\n") + "\r\n"
