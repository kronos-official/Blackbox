ALTER TABLE `groupMemberDailyStats` ADD `joinedViaInviteLinkCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groupMemberDailyStats` ADD `manuallyAddedCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groupMemberDailyStats` ADD `expelledCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groupMemberDailyStats` ADD `mutedCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groupUserDailyStats` ADD `forwardedMessageCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groupUserDailyStats` ADD `videoNoteCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groupUserDailyStats` ADD `animationCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groupUserDailyStats` ADD `animatedStickerCount` int DEFAULT 0 NOT NULL;