

// minutes until this position's turn
const estimateWait = (position, durationMinutes) => {
    if (!Number.isSafeInteger(position) || position < 1) {
        throw new RangeError("Position must be a positive whole num.");
    }
    if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480) {
        throw new RangeError("Duration must be a whole number between 1 and 480 minutes.");
    }
    const peopleAhead = position - 1;
    return peopleAhead * durationMinutes;
};

module.exports = { estimateWait };
