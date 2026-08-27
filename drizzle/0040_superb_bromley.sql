CREATE TABLE `cryptoMarketAlertHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`alertId` int NOT NULL,
	`assetId` varchar(128) NOT NULL,
	`assetName` varchar(160) NOT NULL,
	`assetSymbol` varchar(32) NOT NULL,
	`triggerType` enum('target_above','target_below') NOT NULL,
	`priceUsd` varchar(48) NOT NULL,
	`priceToman` varchar(48),
	`previousUsd` varchar(48),
	`targetPriceUsd` varchar(48) NOT NULL,
	`source` varchar(48) NOT NULL,
	`privateDeliveryRequested` boolean NOT NULL DEFAULT false,
	`privateDelivered` boolean,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cryptoMarketAlertHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cryptoMarketAlertSchedulers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`intervalMinutes` int NOT NULL DEFAULT 15,
	`scheduleCronTaskUid` varchar(65),
	`enabled` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cryptoMarketAlertSchedulers_id` PRIMARY KEY(`id`),
	CONSTRAINT `crypto_market_alert_schedulers_user_unique` UNIQUE(`telegramUserId`)
);
--> statement-breakpoint
CREATE TABLE `cryptoMarketAlerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`assetId` varchar(128) NOT NULL,
	`assetName` varchar(160) NOT NULL,
	`assetSymbol` varchar(32) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`intervalMinutes` int NOT NULL DEFAULT 15,
	`targetPriceUsd` varchar(48) NOT NULL,
	`targetDirection` enum('above','below') NOT NULL DEFAULT 'above',
	`privateDeliveryEnabled` boolean NOT NULL DEFAULT false,
	`lastObservedUsd` varchar(48),
	`lastCheckedAt` timestamp,
	`lastAlertedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cryptoMarketAlerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `crypto_market_alerts_user_asset_unique` UNIQUE(`telegramUserId`,`assetId`)
);
--> statement-breakpoint
CREATE INDEX `crypto_market_alert_history_user_created_idx` ON `cryptoMarketAlertHistory` (`telegramUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `crypto_market_alert_history_alert_created_idx` ON `cryptoMarketAlertHistory` (`alertId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `crypto_market_alert_schedulers_task_uid_idx` ON `cryptoMarketAlertSchedulers` (`scheduleCronTaskUid`);--> statement-breakpoint
CREATE INDEX `crypto_market_alert_schedulers_enabled_idx` ON `cryptoMarketAlertSchedulers` (`enabled`);--> statement-breakpoint
CREATE INDEX `crypto_market_alerts_user_enabled_idx` ON `cryptoMarketAlerts` (`telegramUserId`,`enabled`);--> statement-breakpoint
CREATE INDEX `crypto_market_alerts_due_idx` ON `cryptoMarketAlerts` (`enabled`,`lastCheckedAt`);