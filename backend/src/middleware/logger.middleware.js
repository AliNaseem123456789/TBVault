// One line per request: method, path, status, duration.
// The query string is left out on purpose: reset-password, confirm-email and the
// Google callback carry one-time tokens/codes there, and logs shouldn't hold them.
export const requestLogger = (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        const path = req.originalUrl.split("?")[0];
        console.log(`${req.method} ${path} ${res.statusCode} ${ms.toFixed(2)}ms`);
    });
    next();
};
