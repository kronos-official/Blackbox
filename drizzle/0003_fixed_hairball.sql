CREATE TABLE `marketplacePaymentSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`starsPerDay` int NOT NULL DEFAULT 10,
	`iranRialsPerDay` int,
	`cardRecipientName` varchar(255) NOT NULL DEFAULT 'Forouzan Nemati',
	`cardNumber` varchar(32) NOT NULL DEFAULT '6219861915168891',
	`cardBank` varchar(128) NOT NULL DEFAULT 'Blu Bank',
	`cryptoWallets` json,
	`updatedByTelegramId` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `marketplacePaymentSettings_id` PRIMARY KEY(`id`)
);
