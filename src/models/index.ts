import type { Sequelize } from "sequelize";
import { DataTypes, Model, type Optional } from "sequelize";

export type DocumentScope = "library" | "chat";
export type IndexingStatus = "pending" | "ready" | "failed";

export interface ProjectDocumentAttrs {
	id: string;
	scope: DocumentScope;
	chatId: string | null;
	name: string;
	description: string | null;
	s3Key: string;
	s3Bucket: string;
	mimeType: string;
	sizeBytes: number;
	fileSearchStoreName: string | null;
	indexingStatus: IndexingStatus;
	indexingError: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

type ProjectDocumentCreation = Optional<
	ProjectDocumentAttrs,
	| "id"
	| "chatId"
	| "description"
	| "fileSearchStoreName"
	| "indexingStatus"
	| "indexingError"
	| "createdAt"
	| "updatedAt"
>;

export class ProjectDocument extends Model<
	ProjectDocumentAttrs,
	ProjectDocumentCreation
> {
	declare id: string;
	declare scope: DocumentScope;
	declare chatId: string | null;
	declare name: string;
	declare description: string | null;
	declare s3Key: string;
	declare s3Bucket: string;
	declare mimeType: string;
	declare sizeBytes: number;
	declare fileSearchStoreName: string | null;
	declare indexingStatus: IndexingStatus;
	declare indexingError: string | null;
	declare readonly createdAt: Date;
	declare readonly updatedAt: Date;
}

export interface ChatAttrs {
	id: string;
	title: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

type ChatCreation = Optional<ChatAttrs, "id" | "title" | "createdAt" | "updatedAt">;

export class Chat extends Model<ChatAttrs, ChatCreation> {
	declare id: string;
	declare title: string | null;
	declare readonly createdAt: Date;
	declare readonly updatedAt: Date;
}

export interface MessageAttrs {
	id: string;
	chatId: string;
	role: "user" | "assistant";
	content: string;
	citationsJson: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

type MessageCreation = Optional<
	MessageAttrs,
	"id" | "citationsJson" | "createdAt" | "updatedAt"
>;

export class Message extends Model<MessageAttrs, MessageCreation> {
	declare id: string;
	declare chatId: string;
	declare role: "user" | "assistant";
	declare content: string;
	declare citationsJson: string | null;
	declare readonly createdAt: Date;
	declare readonly updatedAt: Date;
	declare attachments?: MessageAttachment[];
}

export interface MessageAttachmentAttrs {
	id: string;
	messageId: string | null;
	documentId: string;
	createdAt?: Date;
	updatedAt?: Date;
}

type MessageAttachmentCreation = Optional<
	MessageAttachmentAttrs,
	"id" | "messageId" | "createdAt" | "updatedAt"
>;

/** Links uploaded chat files to the user message they belong to (optional until send). */
export class MessageAttachment extends Model<
	MessageAttachmentAttrs,
	MessageAttachmentCreation
> {
	declare id: string;
	declare messageId: string | null;
	declare documentId: string;
	declare readonly createdAt: Date;
	declare readonly updatedAt: Date;
	declare document?: ProjectDocument;
}

export interface ChatIncludedLibraryAttrs {
	id: string;
	chatId: string;
	documentId: string;
	createdAt?: Date;
	updatedAt?: Date;
}

type ChatIncludedLibraryCreation = Optional<
	ChatIncludedLibraryAttrs,
	"id" | "createdAt" | "updatedAt"
>;

/** Library docs explicitly included in file-search context for this chat (default none; locked after first message). */
export class ChatIncludedLibraryDoc extends Model<
	ChatIncludedLibraryAttrs,
	ChatIncludedLibraryCreation
> {
	declare id: string;
	declare chatId: string;
	declare documentId: string;
	declare readonly createdAt: Date;
	declare readonly updatedAt: Date;
}

function initModels(sql: Sequelize) {
	ProjectDocument.init(
		{
			id: {
				type: DataTypes.UUID,
				defaultValue: DataTypes.UUIDV4,
				primaryKey: true,
			},
			scope: {
				type: DataTypes.ENUM("library", "chat"),
				allowNull: false,
			},
			chatId: {
				type: DataTypes.UUID,
				allowNull: true,
			},
			name: { type: DataTypes.STRING(512), allowNull: false },
			description: { type: DataTypes.TEXT, allowNull: true },
			s3Key: { type: DataTypes.STRING(1024), allowNull: false },
			s3Bucket: { type: DataTypes.STRING(255), allowNull: false },
			mimeType: { type: DataTypes.STRING(255), allowNull: false },
			sizeBytes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
			fileSearchStoreName: { type: DataTypes.STRING(512), allowNull: true },
			indexingStatus: {
				type: DataTypes.ENUM("pending", "ready", "failed"),
				allowNull: false,
				defaultValue: "pending",
			},
			indexingError: { type: DataTypes.TEXT, allowNull: true },
		},
		{ sequelize: sql, tableName: "project_documents", modelName: "ProjectDocument" },
	);

	Chat.init(
		{
			id: {
				type: DataTypes.UUID,
				defaultValue: DataTypes.UUIDV4,
				primaryKey: true,
			},
			title: { type: DataTypes.STRING(512), allowNull: true },
		},
		{ sequelize: sql, tableName: "chats", modelName: "Chat" },
	);

	Message.init(
		{
			id: {
				type: DataTypes.UUID,
				defaultValue: DataTypes.UUIDV4,
				primaryKey: true,
			},
			chatId: { type: DataTypes.UUID, allowNull: false },
			role: { type: DataTypes.ENUM("user", "assistant"), allowNull: false },
			content: { type: DataTypes.TEXT("long"), allowNull: false },
			citationsJson: { type: DataTypes.TEXT("long"), allowNull: true },
		},
		{ sequelize: sql, tableName: "messages", modelName: "Message" },
	);

	MessageAttachment.init(
		{
			id: {
				type: DataTypes.UUID,
				defaultValue: DataTypes.UUIDV4,
				primaryKey: true,
			},
			messageId: { type: DataTypes.UUID, allowNull: true },
			documentId: { type: DataTypes.UUID, allowNull: false },
		},
		{
			sequelize: sql,
			tableName: "message_attachments",
			modelName: "MessageAttachment",
		},
	);

	ChatIncludedLibraryDoc.init(
		{
			id: {
				type: DataTypes.UUID,
				defaultValue: DataTypes.UUIDV4,
				primaryKey: true,
			},
			chatId: { type: DataTypes.UUID, allowNull: false },
			documentId: { type: DataTypes.UUID, allowNull: false },
		},
		{
			sequelize: sql,
			tableName: "chat_included_library_documents",
			modelName: "ChatIncludedLibraryDoc",
			indexes: [
				{
					unique: true,
					fields: ["chat_id", "document_id"],
					name: "chat_included_library_documents_chat_document_uq",
				},
			],
		},
	);

	Chat.hasMany(Message, { foreignKey: "chatId", onDelete: "CASCADE" });
	Message.belongsTo(Chat, { foreignKey: "chatId" });

	Message.hasMany(MessageAttachment, {
		foreignKey: "messageId",
		onDelete: "CASCADE",
		as: "attachments",
	});
	MessageAttachment.belongsTo(Message, { foreignKey: "messageId" });

	ProjectDocument.hasMany(MessageAttachment, {
		foreignKey: "documentId",
		onDelete: "CASCADE",
	});
	MessageAttachment.belongsTo(ProjectDocument, {
		foreignKey: "documentId",
		as: "document",
	});

	Chat.hasMany(ProjectDocument, { foreignKey: "chatId", onDelete: "SET NULL" });
	ProjectDocument.belongsTo(Chat, { foreignKey: "chatId" });

	Chat.hasMany(ChatIncludedLibraryDoc, {
		foreignKey: "chatId",
		onDelete: "CASCADE",
		as: "includedLibraryDocs",
	});
	ChatIncludedLibraryDoc.belongsTo(Chat, { foreignKey: "chatId" });
	ChatIncludedLibraryDoc.belongsTo(ProjectDocument, { foreignKey: "documentId" });
}

export function registerModels(sql: Sequelize) {
	if (sql.models.ProjectDocument) return;
	initModels(sql);
}
