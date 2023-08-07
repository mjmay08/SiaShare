export function parseRangeHeader(range: string, fileSize: number): number[] {
    /** Extracting Start and End value from Range Header */
    let [start, end]: any[] = range.replace(/bytes=/, "").split("-");
    start = parseInt(start, 10);
    end = end ? parseInt(end, 10) : fileSize - 1;

    if (!isNaN(start) && isNaN(end)) {
        start = start;
        end = fileSize - 1;
    }
    if (isNaN(start) && !isNaN(end)) {
        start = fileSize - end;
        end = fileSize - 1;
    }
    return [start, end];
}