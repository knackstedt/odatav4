
import Lexer from '../lexer';
import { SQLLang, type SqlOptions } from "./types";
import { Visitor } from "./visitor";

export class MsSqlVisitor extends Visitor {
    constructor(options = <SqlOptions>{}, ast: Lexer.Token) {
        // Force parameterized literals to prevent SQL injection. The base
        // VisitLiteral inlines SQLLiteral.convert() output directly into the
        // query when useParameters is false, and SQLLiteral's Edm.String
        // handler decodes OData's '' escaping without re-escaping for SQL,
        // allowing an attacker to break out of the string literal. Binding
        // values as parameters neutralizes the payload.
        super({ useParameters: true, ...options, type: SQLLang.MsSql }, ast);
    }

    protected VisitMethodCallExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const method = node.value.method;
        const params = node.value.parameters || [];

        switch (method) {
            case "indexof":
                this[target] += `(CHARINDEX(`;
                this.Visit(params[1], context); // substring
                this[target] += ", ";
                this.Visit(params[0], context); // string
                this[target] += `) - 1)`;
                break;
            default:
                super.VisitMethodCallExpression(node, context);
                break;
        }
    }
}
