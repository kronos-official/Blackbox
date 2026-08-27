CREATE TABLE `cryptoMarketFavorites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`assetId` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cryptoMarketFavorites_id` PRIMARY KEY(`id`),
	CONSTRAINT `crypto_market_favorites_user_asset_unique` UNIQUE(`telegramUserId`,`assetId`)
);
--> statement-breakpoint
CREATE INDEX `crypto_market_favorites_user_created_idx` ON `cryptoMarketFavorites` (`telegramUserId`,`createdAt`);