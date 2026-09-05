
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
            case "round":
                // MSSQL ROUND requires a precision argument
                this[target] += "ROUND(";
                this.Visit(params[0], context);
                this[target] += ", 0)";
                break;
            case "date":
                this[target] += "CAST(";
                this.Visit(params[0], context);
                this[target] += " AS DATE)";
                break;
            case "time":
                this[target] += "CAST(";
                this.Visit(params[0], context);
                this[target] += " AS TIME)";
                break;
            case "fractionalseconds":
                this[target] += "DATEPART(NANOSECOND, ";
                this.Visit(params[0], context);
                this[target] += ") / 1000000000.0";
                break;
            case "totalseconds":
                this[target] += "DATEDIFF(SECOND, '1970-01-01', ";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            default:
                super.VisitMethodCallExpression(node, context);
                break;
        }
    }
}
