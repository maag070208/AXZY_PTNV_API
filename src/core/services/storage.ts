import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
      // (p.ej. x-amz-checksum-mode) a los requests, evitando efectos
      // secundarios inesperados en la firma de las peticiones a S3.
      // https://github.com/aws/aws-sdk-js-v3/issues/6994
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    })
  : null;

export const uploadObject = async (key: string, body: Buffer, contentType: string) => {
  if (!client || !env.AWS_BUCKET_NAME) {
    throw new HttpError(503, "STORAGE_NOT_CONFIGURED");
  }
  await client.send(new PutObjectCommand({
    Bucket: env.AWS_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
};

export const downloadObject = async (key: string) => {
  const publicUrl = `https://${env.AWS_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
  try {
    const response = await fetch(publicUrl);
    if (response.ok) return Buffer.from(await response.arrayBuffer());
  } catch {
    // Fall back to the SDK when the public object URL is unavailable.
  }

  if (!client || !env.AWS_BUCKET_NAME) {
    throw new HttpError(503, "STORAGE_NOT_CONFIGURED");
  }
  const result = await client.send(new GetObjectCommand({ Bucket: env.AWS_BUCKET_NAME, Key: key }));
  if (!result.Body) throw new HttpError(404, "FILE_NOT_FOUND");
  return Buffer.from(await result.Body.transformToByteArray());
};

// URL publica directa al objeto (mismo patron que ~/DEV/CHECK/FANSAL/API).
// No requiere firmar la peticion ni permisos IAM de lectura (s3:GetObject),
// por lo que no depende de las credenciales configuradas ni expira nunca
// mientras el bucket permita lectura publica sobre el prefijo del objeto.
export const publicObjectUrl = (key: string) => {
  if (!env.AWS_BUCKET_NAME) {
    throw new HttpError(503, "STORAGE_NOT_CONFIGURED");
  }
  return `https://${env.AWS_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
};
