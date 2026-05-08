import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client: S3Client | null = null;

function getClient(): S3Client {
	if (!client) {
		const region = process.env.AWS_REGION ?? "us-east-1";
		client = new S3Client({
			region,
			credentials:
				process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
					? {
							accessKeyId: process.env.AWS_ACCESS_KEY_ID,
							secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
						}
					: undefined,
		});
	}
	return client;
}

export function getBucket(): string {
	const bucket = process.env.AWS_S3_BUCKET;
	if (!bucket) throw new Error("AWS_S3_BUCKET is not set.");
	return bucket;
}

export async function putDocumentObject(params: {
	key: string;
	body: Buffer;
	contentType: string;
}): Promise<void> {
	await getClient().send(
		new PutObjectCommand({
			Bucket: getBucket(),
			Key: params.key,
			Body: params.body,
			ContentType: params.contentType,
		}),
	);
}

export async function deleteDocumentObject(key: string): Promise<void> {
	await getClient().send(
		new DeleteObjectCommand({
			Bucket: getBucket(),
			Key: key,
		}),
	);
}

export async function getPresignedGetUrl(params: {
	key: string;
	expiresInSeconds?: number;
	inlineFilename?: string;
}): Promise<string> {
	const bucket = getBucket();
	const command = new GetObjectCommand({
		Bucket: bucket,
		Key: params.key,
		ResponseContentDisposition: params.inlineFilename
			? `inline; filename="${params.inlineFilename.replace(/"/g, "")}"`
			: "inline",
	});
	return getSignedUrl(getClient(), command, {
		expiresIn: params.expiresInSeconds ?? 3600,
	});
}
