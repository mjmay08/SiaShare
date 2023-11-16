export function parseRangeHeader(range: string, fileSize: number): number[] {
    /** Extracting Start and End value from Range Header */
    const [startStr, endStr]: string[] = range.replace(/bytes=/, "").split("-");
    let start = parseInt(startStr, 10);
    let end = endStr ? parseInt(endStr, 10) : fileSize - 1;

    if (!isNaN(start) && isNaN(end)) {
        end = fileSize - 1;
    }
    if (isNaN(start) && !isNaN(end)) {
        start = fileSize - end;
        end = fileSize - 1;
    }
    return [start, end];
}