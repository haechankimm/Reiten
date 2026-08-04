const cloudinary = require("cloudinary").v2;

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/* 업로드 즉시 리사이즈 + 포맷/화질 자동 최적화한다.
   crop:"limit"은 지정한 박스보다 큰 사진만 줄이고 작은 사진은 확대하지 않는다.
   quality/fetch_format을 "auto"로 두면 Cloudinary가 브라우저에 맞춰 WebP/AVIF 등으로 자동 변환한다 —
   관리자가 원본 대용량 사진을 그대로 올려도 저장·전송 용량이 커지지 않는다. */
function upload(buffer, folder, { maxSize }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        transformation: [
          { width: maxSize, height: maxSize, crop: "limit" },
          { quality: "auto:good", fetch_format: "auto" },
        ],
      },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    stream.end(buffer);
  });
}

function uploadReviewPhoto(buffer) {
  return upload(buffer, "reiten-reviews", { maxSize: 1600 });
}

function uploadProductPhoto(buffer) {
  return upload(buffer, "reiten-products", { maxSize: 1800 });
}

module.exports = { uploadReviewPhoto, uploadProductPhoto };
