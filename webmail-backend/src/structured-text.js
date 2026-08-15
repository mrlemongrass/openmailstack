"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitEscapedTextList = splitEscapedTextList;
/** Split an RFC text-list before unescaping its members. */
function splitEscapedTextList(value) {
    const members = [];
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== ',')
            continue;
        let slashes = 0;
        for (let prior = index - 1; prior >= 0 && value[prior] === '\\'; prior -= 1)
            slashes += 1;
        if (slashes % 2 === 0) {
            members.push(value.slice(start, index));
            start = index + 1;
        }
    }
    members.push(value.slice(start));
    return members;
}
//# sourceMappingURL=structured-text.js.map