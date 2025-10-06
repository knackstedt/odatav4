import { ODataV4ParseError } from './parser/utils';

function integer(value: string): number {
    return +value;
}

function float(value: string): number {
    switch (value) {
        case 'INF': return Infinity;
        case '-INF': return -Infinity;
        default: return +value;
    }
}

export class Literal {
    constructor(type: string, value: string) {
        let result = (this[type] || (_ => _))(value);
        this.valueOf = () => result;
    }

    static convert(type: string, value: string): any {
        return (new Literal(type, value)).valueOf();
    }

    'Edm.String'(value: string) { return decodeURIComponent(value).slice(1, -1).replace(/''/g, "'"); }
    'Edm.Byte'(value: string) { return integer(value); }
    'Edm.SByte'(value: string) { return integer(value); }
    'Edm.Int16'(value: string) { return integer(value); }
    'Edm.Int32'(value: string) { return integer(value); }
    'Edm.Int64'(value: string) { return integer(value); }
    'Edm.Decimal'(value: string) { return float(value); }
    'Edm.Double'(value: string) { return float(value); }
    'Edm.Single'(value: string) { return float(value); }
    'Edm.Boolean'(value: string) {
        value = value || '';
        switch (value.toLowerCase()) {
            case 'true': return true;
            case 'false': return false;
            default: return undefined;
        }
    }

    'Edm.Guid'(value: string) {
        const decoded = decodeURIComponent(value);
        // Note: this doesn't verify a specific GUID version, just the general format.
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded)) {
            throw new ODataV4ParseError({ msg: `Guid ${value} is invalid` });
        }
        return decoded;
    }
    'Edm.Date'(value: string) {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) {
            return value;
        }
        throw new ODataV4ParseError({ msg: `Date ${value} is invalid` });
    }
    'Edm.DateTimeOffset'(value: string) {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) {
            return d;
        }
        throw new ODataV4ParseError({ msg: `DateTimeOffset ${value} is invalid` });
    }
    'null'(value: string) { return null; }
    'Edm.TimeOfDay'(value: string) {
        const d = new Date(`1970-01-01T${value}Z`);
        if (!Number.isNaN(d.getTime())) {
            return d;
        }
        throw new ODataV4ParseError({ msg: `TimeOfDay ${value} is invalid` });
    }
    'Edm.Duration'(value: string) {
        const m = value.match(/P([0-9]*D)?T?([0-9]{1,2}H)?([0-9]{1,2}M)?([\.0-9]*S)?/);
        if (m) {
            const d = new Date(0);
            for (let i = 1; i < m.length; i++) {
                switch (m[i].slice(-1)) {
                    case 'D': d.setDate(parseInt(m[i])); continue;
                    case 'H': d.setHours(parseInt(m[i])); continue;
                    case 'M': d.setMinutes(parseInt(m[i])); continue;
                    case 'S': d.setSeconds(parseFloat(m[i])); continue;
                }
            }

            const time = d.getTime();
            // Ensure the date / time is valid
            if (!Number.isNaN(time)) {
                return d.getTime();
            }
        }
        throw new ODataV4ParseError({ msg: `Duration ${value} is invalid` });
    }
}
