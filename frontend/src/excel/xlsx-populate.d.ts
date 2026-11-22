declare module 'xlsx-populate/browser/xlsx-populate-no-encryption.min.js' {
  export interface XmlNode {
    name: string;
    attributes: Record<string, string | number>;
    children: (XmlNode | string)[];
  }
  export interface Cell {
    value(): unknown;
    value(value: string | number | undefined): Cell;
    formula(): string | undefined;
    style(name: string): unknown;
    style(styles: Record<string, unknown>): Cell;
  }
  export interface Range {
    clear(): Range;
    value(): unknown[][];
    value(value: (string | number | undefined)[][]): Range;
    merged(): boolean;
    merged(value: boolean): Range;
    style(styles: Record<string, unknown>): Range;
  }
  export interface Sheet {
    name(): string;
    name(value: string): Sheet;
    cell(address: string): Cell;
    cell(row: number, column: number): Cell;
    range(address: string): Range;
    range(startRow: number, startColumn: number, endRow: number, endColumn: number): Range;
    usedRange(): Range;
    row(index: number): { height(value: number): unknown };
    column(index: number): {
      width(value: number): unknown;
      hidden(): boolean;
      hidden(value: boolean): unknown;
    };
    definedName(name: string): unknown;
    definedName(name: string, refersTo: string): Sheet;
    pageMarginsPreset(value: string): Sheet;
    pageMargins(name: string, value: number): Sheet;
    printOptions(name: string, value: boolean): Sheet;
    _node: XmlNode;
  }
  export interface Workbook {
    _node: XmlNode;
    _zip: {
      file(path: string): { async(type: 'string'): Promise<string> };
      file(path: string, data: string): unknown;
    };
    sheet(index: number | string): Sheet;
    sheets(): Sheet[];
    addSheet(name: string): Sheet;
    outputAsync(options: { type: 'uint8array' }): Promise<Uint8Array>;
  }
  const XlsxPopulate: {
    fromBlankAsync(): Promise<Workbook>;
    fromDataAsync(data: ArrayBuffer | Uint8Array): Promise<Workbook>;
  };
  export default XlsxPopulate;
}
