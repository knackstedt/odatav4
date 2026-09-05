
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

    protected VisitMethodCallExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const method = node.value.method;
        const params = node.value.parameters || [];

        switch (method) {
            case "indexof":
                this[target] += `(INSTR(`;
                this.Visit(params[0], context); // string
                this[target] += ", ";
                this.Visit(params[1], context); // substring
                this[target] += `) - 1)`;
                break;
            case "totalseconds":
                this[target] += "EXTRACT(DAY FROM (";
                this.Visit(params[0], context);
                this[target] += " - TIMESTAMP '1970-01-01 00:00:00')) * 86400 + TO_NUMBER(TO_CHAR(";
                this.Visit(params[0], context);
                this[target] += ", 'SSSSS'))";
                break;
            default:
                super.VisitMethodCallExpression(node, context);
                break;
        }
    }
}
