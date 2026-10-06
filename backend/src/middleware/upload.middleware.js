import multer from "multer"

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]

// Files are held in memory before going to MinIO, so the limits matter.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,   // 5 MB per image
        files: 6,
    },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true)
        const err = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname)
        err.message = "Only JPEG, PNG, WebP, GIF or AVIF images are allowed"
        cb(err)
    },
})

// Wraps an upload middleware so multer errors become 400s instead of crashing the request.
export const handleUpload = (middleware) => (req, res, next) => {
    middleware(req, res, (err) => {
        if (!err) return next()
        if (err instanceof multer.MulterError) {
            const message = err.code === "LIMIT_FILE_SIZE" ? "Each image must be 5 MB or smaller"
                : err.code === "LIMIT_FILE_COUNT" ? "You can upload at most 6 images at once"
                : err.message
            return res.status(400).json({ message })
        }
        next(err)
    })
}

export default upload
