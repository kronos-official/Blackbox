CREATE TABLE `auditLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`severity` enum('info','warning','critical') NOT NULL DEFAULT 'info',
	`category` varchar(128) NOT NULL,
	`event` varchar(255) NOT NULL,
	`groupId` int,
	`actorTelegramId` bigint,
	`subjectTelegramId` bigint,
	`requestId` varchar(96),
	`details` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `channelListings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channelChatId` bigint NOT NULL,
	`ownerTelegramId` bigint NOT NULL,
	`requestedDays` int NOT NULL,
	`starsPerDay` int NOT NULL DEFAULT 10,
	`localCurrencyAmount` int,
	`localCurrencyCode` varchar(16) DEFAULT 'IRR',
	`status` enum('draft','pending_payment','pending_approval','active','paused','expired','rejected','cancelled') NOT NULL DEFAULT 'draft',
	`activatedAt` timestamp,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `channelListings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contentLocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`lockType` enum('link','photo','video','voice','audio','sticker','gif','document','forward','mention','hashtag','emoji','phone','location','poll','game','bot','command','english','persian','edited_message','long_message','text','reply','inline_button','profanity','all') NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`action` enum('delete','warn','mute') NOT NULL DEFAULT 'delete',
	`exemptionRole` enum('none','vip','moderator','admin') NOT NULL DEFAULT 'vip',
	`updatedByTelegramId` bigint,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contentLocks_id` PRIMARY KEY(`id`),
	CONSTRAINT `content_locks_group_type_unique` UNIQUE(`groupId`,`lockType`)
);
--> statement-breakpoint
CREATE TABLE `customCommands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`trigger` varchar(255) NOT NULL,
	`response` text NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`createdByTelegramId` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customCommands_id` PRIMARY KEY(`id`),
	CONSTRAINT `custom_commands_group_trigger_unique` UNIQUE(`groupId`,`trigger`)
);
--> statement-breakpoint
CREATE TABLE `filterRules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`pattern` varchar(1000) NOT NULL,
	`matchType` enum('word','phrase','regex') NOT NULL DEFAULT 'word',
	`action` enum('delete','warn','mute','ban') NOT NULL DEFAULT 'delete',
	`enabled` boolean NOT NULL DEFAULT true,
	`createdByTelegramId` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `filterRules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `forcedJoinChannels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int,
	`channelChatId` bigint NOT NULL,
	`username` varchar(128),
	`title` varchar(512) NOT NULL,
	`inviteUrl` varchar(1024),
	`scope` enum('global','group','marketplace') NOT NULL DEFAULT 'marketplace',
	`status` enum('pending','active','paused','expired','rejected') NOT NULL DEFAULT 'pending',
	`ownerTelegramId` bigint NOT NULL,
	`listingId` int,
	`requiresAdminVerification` boolean NOT NULL DEFAULT true,
	`lastVerifiedAt` timestamp,
	`startsAt` timestamp,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `forcedJoinChannels_id` PRIMARY KEY(`id`),
	CONSTRAINT `forced_join_channels_chat_scope_unique` UNIQUE(`channelChatId`,`scope`,`groupId`)
);
--> statement-breakpoint
CREATE TABLE `forcedJoinSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`locked` boolean NOT NULL DEFAULT false,
	`missingChannelIds` json,
	`lockReason` varchar(128),
	`lastMembershipCheckAt` timestamp,
	`lastPromptMessageId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `forcedJoinSessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `forced_join_sessions_user_unique` UNIQUE(`telegramUserId`)
);
--> statement-breakpoint
CREATE TABLE `globalAdmins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`grantedByTelegramId` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `globalAdmins_id` PRIMARY KEY(`id`),
	CONSTRAINT `global_admins_tg_id_unique` UNIQUE(`telegramUserId`)
);
--> statement-breakpoint
CREATE TABLE `groupRoles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`role` enum('group_owner','group_admin','moderator','vip') NOT NULL,
	`grantedByTelegramId` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `groupRoles_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_roles_scope_user_role_unique` UNIQUE(`groupId`,`telegramUserId`,`role`)
);
--> statement-breakpoint
CREATE TABLE `groupSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`welcomeEnabled` boolean NOT NULL DEFAULT true,
	`welcomeMessage` text,
	`goodbyeEnabled` boolean NOT NULL DEFAULT false,
	`goodbyeMessage` text,
	`warnLimit` int NOT NULL DEFAULT 3,
	`warnAction` enum('mute','ban') NOT NULL DEFAULT 'mute',
	`warnMuteMinutes` int NOT NULL DEFAULT 60,
	`antiSpamEnabled` boolean NOT NULL DEFAULT true,
	`antiRaidEnabled` boolean NOT NULL DEFAULT true,
	`floodMessageLimit` int NOT NULL DEFAULT 7,
	`floodWindowSeconds` int NOT NULL DEFAULT 12,
	`duplicateMessageLimit` int NOT NULL DEFAULT 3,
	`serviceMessagesEnabled` boolean NOT NULL DEFAULT true,
	`rulesText` text,
	`customSettings` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `groupSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_settings_group_unique` UNIQUE(`groupId`)
);
--> statement-breakpoint
CREATE TABLE `moderationActions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`actorTelegramId` bigint,
	`targetTelegramId` bigint,
	`action` enum('ban','kick','mute','unmute','unban','warn','unwarn','delete','lock','unlock','raid_block') NOT NULL,
	`source` enum('manual','command','automated','scheduler') NOT NULL,
	`commandAlias` varchar(64),
	`reason` text,
	`expiresAt` timestamp,
	`telegramMessageId` int,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `moderationActions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `moderationNotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`targetTelegramId` bigint NOT NULL,
	`authorTelegramId` bigint NOT NULL,
	`body` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `moderationNotes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ownerAlerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alertType` enum('raid','spam_wave','forced_join_expired','bot_permission_lost','webhook_problem','database_problem','scheduler_failure','payment_approval') NOT NULL,
	`severity` enum('warning','critical') NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`relatedEntityType` varchar(64),
	`relatedEntityId` int,
	`dedupeKey` varchar(255) NOT NULL,
	`status` enum('pending','sent','failed','acknowledged') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`lastAttemptAt` timestamp,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ownerAlerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `owner_alerts_dedupe_unique` UNIQUE(`dedupeKey`)
);
--> statement-breakpoint
CREATE TABLE `paymentOrders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publicId` varchar(48) NOT NULL,
	`listingId` int NOT NULL,
	`payerTelegramId` bigint NOT NULL,
	`method` enum('telegram_stars','card_to_card','usdt_nowpayments','doge_manual','shib_manual','dron_manual','ltc_manual') NOT NULL,
	`status` enum('created','awaiting_payment','receipt_submitted','pending_approval','paid','rejected','expired','refunded','cancelled') NOT NULL DEFAULT 'created',
	`amountStars` int,
	`amountMinor` int,
	`currency` varchar(16) NOT NULL,
	`providerReference` varchar(255),
	`providerPayload` json,
	`reviewedByTelegramId` bigint,
	`reviewedAt` timestamp,
	`expiresAt` timestamp,
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `paymentOrders_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_orders_public_id_unique` UNIQUE(`publicId`)
);
--> statement-breakpoint
CREATE TABLE `paymentReceipts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`paymentOrderId` int NOT NULL,
	`storageKey` varchar(1024) NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`originalFilename` varchar(512),
	`byteSize` int,
	`submittedByTelegramId` bigint NOT NULL,
	`submittedAt` timestamp NOT NULL DEFAULT (now()),
	`deletedAt` timestamp,
	CONSTRAINT `paymentReceipts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduledJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobType` enum('listing_expiry','temporary_punishment_expiry','forced_join_audit','cleanup','alert_retry') NOT NULL,
	`idempotencyKey` varchar(255) NOT NULL,
	`payload` json NOT NULL,
	`status` enum('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
	`runAfter` timestamp NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`lastError` text,
	`lockedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduledJobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduled_jobs_idempotency_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `telegramGroups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chatId` bigint NOT NULL,
	`title` varchar(512) NOT NULL,
	`username` varchar(128),
	`ownerTelegramId` bigint,
	`language` varchar(16) NOT NULL DEFAULT 'fa',
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Tehran',
	`status` enum('active','permission_lost','removed','paused') NOT NULL DEFAULT 'active',
	`botPermissions` json,
	`installedAt` timestamp NOT NULL DEFAULT (now()),
	`lastActivityAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegramGroups_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_groups_chat_id_unique` UNIQUE(`chatId`)
);
--> statement-breakpoint
CREATE TABLE `telegramUsers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`username` varchar(128),
	`firstName` varchar(256),
	`lastName` varchar(256),
	`languageCode` varchar(16),
	`preferredLocale` varchar(16) DEFAULT 'fa',
	`isBot` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegramUsers_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_users_tg_id_unique` UNIQUE(`telegramUserId`)
);
--> statement-breakpoint
CREATE TABLE `userWarnings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`count` int NOT NULL DEFAULT 0,
	`lastReason` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userWarnings_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_warnings_group_user_unique` UNIQUE(`groupId`,`telegramUserId`)
);
--> statement-breakpoint
CREATE TABLE `webhookEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`updateId` int NOT NULL,
	`eventType` varchar(128) NOT NULL,
	`status` enum('received','processed','ignored','failed') NOT NULL DEFAULT 'received',
	`errorMessage` text,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	CONSTRAINT `webhookEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `webhook_events_update_unique` UNIQUE(`updateId`)
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `auditLogs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `audit_logs_group_idx` ON `auditLogs` (`groupId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `channel_listings_status_expiry_idx` ON `channelListings` (`status`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `channel_listings_owner_idx` ON `channelListings` (`ownerTelegramId`);--> statement-breakpoint
CREATE INDEX `filter_rules_group_idx` ON `filterRules` (`groupId`);--> statement-breakpoint
CREATE INDEX `forced_join_channels_status_expiry_idx` ON `forcedJoinChannels` (`status`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `forced_join_sessions_locked_idx` ON `forcedJoinSessions` (`locked`);--> statement-breakpoint
CREATE INDEX `group_roles_group_user_idx` ON `groupRoles` (`groupId`,`telegramUserId`);--> statement-breakpoint
CREATE INDEX `moderation_actions_group_created_idx` ON `moderationActions` (`groupId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `moderation_actions_expiry_idx` ON `moderationActions` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `moderation_notes_group_target_idx` ON `moderationNotes` (`groupId`,`targetTelegramId`);--> statement-breakpoint
CREATE INDEX `owner_alerts_status_idx` ON `ownerAlerts` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `payment_orders_status_created_idx` ON `paymentOrders` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `payment_orders_payer_idx` ON `paymentOrders` (`payerTelegramId`);--> statement-breakpoint
CREATE INDEX `payment_receipts_order_idx` ON `paymentReceipts` (`paymentOrderId`);--> statement-breakpoint
CREATE INDEX `scheduled_jobs_due_idx` ON `scheduledJobs` (`status`,`runAfter`);--> statement-breakpoint
CREATE INDEX `telegram_groups_status_idx` ON `telegramGroups` (`status`);--> statement-breakpoint
CREATE INDEX `webhook_events_status_idx` ON `webhookEvents` (`status`,`receivedAt`);