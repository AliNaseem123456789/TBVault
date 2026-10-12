"""Downloads product photos from the same S3 bucket (or MinIO) the backend uploads to."""
from functools import lru_cache

from app import config


@lru_cache(maxsize=None)
def _s3():
    import boto3
    options = {"region_name": config.S3_REGION}
    if config.S3_ENDPOINT:  # MinIO
        options["endpoint_url"] = config.S3_ENDPOINT
    if config.S3_ACCESS_KEY_ID and config.S3_SECRET_ACCESS_KEY:
        options["aws_access_key_id"] = config.S3_ACCESS_KEY_ID
        options["aws_secret_access_key"] = config.S3_SECRET_ACCESS_KEY
    # Without keys boto3 uses your normal AWS login (~/.aws or the server's IAM role).
    return boto3.client("s3", **options)


def download(key):
    return _s3().get_object(Bucket=config.S3_BUCKET, Key=key)["Body"].read()
