CREATE TABLE `forcedJoinAcquisitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`forcedJoinChannelId` int NOT NULL,
	`verifiedCount` int NOT NULL DEFAULT 0,
	`lastVerifiedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `forcedJoinAcquisitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `forced_join_acquisitions_channel_unique` UNIQUE(`forcedJoinChannelId`)
);
