-- Library docs explicitly included in chat context (unchecked = omitted by default).
-- Replaces semantics of chat_excluded_library_documents if upgrading.

DROP TABLE IF EXISTS `chat_excluded_library_documents`;

CREATE TABLE IF NOT EXISTS `chat_included_library_documents` (
	`id` CHAR(36) NOT NULL,
	`chat_id` CHAR(36) NOT NULL,
	`document_id` CHAR(36) NOT NULL,
	`created_at` DATETIME NOT NULL,
	`updated_at` DATETIME NOT NULL,
	PRIMARY KEY (`id`),
	UNIQUE KEY `chat_included_library_documents_chat_document_uq` (`chat_id`, `document_id`),
	KEY `chat_included_library_documents_chat_id` (`chat_id`),
	KEY `chat_included_library_documents_document_id` (`document_id`),
	CONSTRAINT `chat_included_library_documents_chat_id_fkey`
		FOREIGN KEY (`chat_id`) REFERENCES `chats` (`id`)
		ON DELETE CASCADE ON UPDATE CASCADE,
	CONSTRAINT `chat_included_library_documents_document_id_fkey`
		FOREIGN KEY (`document_id`) REFERENCES `project_documents` (`id`)
		ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
