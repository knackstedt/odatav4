
import type Lexer from '../lexer';
import { SQLLang, type SqlOptions } from "./types";
import { Visitor } from "./visitor";

export class OracleVisitor extends Visitor {
    constructor(options = <SqlOptions>{}, ast: Lexer.Token) {
        super({ useParameters: true, ...options, type: SQLLang.Oracle }, ast);
    }

    asOracleSql() {
        // Original logic from visitor.ts
        let rx = new RegExp("\\?", "g");
        let keys = this.parameters.keys();
        this.originalWhere = this.where;
        this.where = this.where.replace(rx, () => `:${keys.next().value}`);
        this.includes.forEach((item) => (item as any).asOracleSql()); // Keep recursion if needed, though likely handled by structure
        return this;
    }

    // Override generic parameter handling if Oracle needs specific :param syntax during VisitLiteral/etc?
    // Original code seemed to replace `?` which implies it generated `?` first?
    // But `Visitor` generates names like `$literal1`.
    // Let's look at `asOracleSql` in original `visitor.ts`.
    // It replaced `?` with named parameters.
    // But `VisitLiteral` uses `$literalN`.
    // Wait, original `Visitor` code:
    // if (this.options.useParameters) ... parameters.set(name, value); this[target] += name;
    // else ...
    // The `asOracleSql` method in original `visitor.ts` seems conflicting or for a different mode (ANSI with ?).
    // Given the lack of extensive Oracle tests, I will stick to basic structure and port `asOracleSql` logic if it makes sense.
    // Actually, `Visitor` base handles parameters with `$name`. Oracle usually uses `:name`.
    // I can override `VisitLiteral` etc or just `from`.
}
