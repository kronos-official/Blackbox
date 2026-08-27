CREATE TABLE `globalBotSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`settingKey` varchar(128) NOT NULL,
	`settingValue` text NOT NULL,
	`valueType` enum('string','number','boolean','json') NOT NULL DEFAULT 'string',
	`updatedByTelegramId` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT 'CURRENT_TIMESTAMP',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `global_bot_settings_key_unique` UNIQUE(`settingKey`)
);
--> statement-breakpoint
CREATE TABLE `globalBotTexts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`textKey` varchar(160) NOT NULL,
	`category` varchar(64) NOT NULL,
	`textValue` text NOT NULL,
	`enabled` boolean NOT NULL DEFAULT 1,
	`updatedByTelegramId` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT 'CURRENT_TIMESTAMP',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `global_bot_texts_key_unique` UNIQUE(`textKey`)
);
--> statement-breakpoint
CREATE TABLE `ownerConfigRevisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`version` int NOT NULL,
	`scope` varchar(32) NOT NULL DEFAULT 'global',
	`changeSummary` varchar(512) NOT NULL,
	`snapshot` json NOT NULL,
	`status` enum('draft','published','reverted') NOT NULL DEFAULT 'draft',
	`createdByTelegramId` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE INDEX `global_bot_texts_category_idx` ON `globalBotTexts` (`category`);--> statement-breakpoint
CREATE INDEX `owner_config_revisions_version_idx` ON `ownerConfigRevisions` (`version`);--> statement-breakpoint
CREATE INDEX `owner_config_revisions_status_idx` ON `ownerConfigRevisions` (`status`,`createdAt`);