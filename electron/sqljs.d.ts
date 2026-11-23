declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database
  }

  interface QueryExecResult {
    columns: string[]
    values: any[][]
  }

  interface Statement {
    bind(params?: any[]): boolean
    step(): boolean
    getAsObject(params?: object): any
    free(): boolean
    reset(): void
  }

  interface Database {
    run(sql: string, params?: any[]): Database
    exec(sql: string): QueryExecResult[]
    prepare(sql: string): Statement
    getRowsModified(): number
    export(): Uint8Array
    close(): void
  }

  export function locateFile(file: string): string
  export type Database = Database
  export type Statement = Statement
  export type SqlJsStatic = SqlJsStatic
  export type QueryExecResult = QueryExecResult

  export default function initSqlJs(config?: any): Promise<SqlJsStatic>
}
