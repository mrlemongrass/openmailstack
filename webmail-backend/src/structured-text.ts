/** Split an RFC text-list before unescaping its members. */
export function splitEscapedTextList(value: string): string[] {
    const members: string[] = [];
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== ',') continue;
        let slashes = 0;
        for (let prior = index - 1; prior >= 0 && value[prior] === '\\'; prior -= 1) slashes += 1;
        if (slashes % 2 === 0) {
            members.push(value.slice(start, index));
            start = index + 1;
        }
    }
    members.push(value.slice(start));
    return members;
}
