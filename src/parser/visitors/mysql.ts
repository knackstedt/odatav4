
import Lexer from '../lexer';
import { SQLLang, type SqlOptions } from "./types";
import { Visitor } from "./visitor";

export class MySqlVisitor extends Visitor {
    constructor(options = <SqlOptions>{}, ast: Lexer.Token) {
        super({ ...options, type: SQLLang.MySql }, ast);
    }

    protected VisitMethodCallExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const method = node.value.method;
        const params = node.value.parameters || [];

        switch (method) {
            case "indexof":
                this[target] += `(LOCATE(`;
                this.Visit(params[1], context); // substring
                this[target] += ", ";
                this.Visit(params[0], context); // string
                this[target] += `) - 1)`;
                break;
            case "fractionalseconds":
                this[target] += "MICROSECOND(";
                this.Visit(params[0], context);
                this[target] += ") / 1000000";
                break;
            case "totalseconds":
                this[target] += "UNIX_TIMESTAMP(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            default:
                super.VisitMethodCallExpression(node, context);
                break;
        }
    }
}
