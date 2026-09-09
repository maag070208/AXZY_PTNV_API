import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@core/config/env.config";
import { HttpError } from "@core/middlewares/error.middleware";

const configured = Boolean(
  env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_BUCKET_NAME
);

const client = configured
  ? new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
      // Evita que el SDK agregue automaticamente parametros de checksum
      // (p.ej. x-amz-checksum-mode=ENABLED) a las URLs firmadas, lo cual
      // puede invalidar la firma y causar 403 en GetObject presignado.
      // https://github.com/aws/aws-sdk-js-v3/issues/6994
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    })
  : null;

export const uploadObject = async (key: string, body: Buffer, contentType: string) => {
  if (!client || !env.AWS_BUCKET_NAME) {
    throw new HttpError(503, "Almacenamiento de archivos no configurado");
  }
  await client.send(new PutObjectCommand({
    Bucket: env.AWS_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
};

export const signedObjectUrl = async (key: string) => {
  if (!client || !env.AWS_BUCKET_NAME) {
    throw new HttpError(503, "Almacenamiento de archivos no configurado");
  }
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: env.AWS_BUCKET_NAME, Key: key }),
    { expiresIn: 900 }
  );
};
