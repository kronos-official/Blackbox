ALTER TABLE `scheduledJobs` MODIFY COLUMN `jobType` enum('listing_expiry','temporary_punishment_expiry','raid_mode_expiry','forced_join_audit','cleanup','alert_retry') NOT NULL;
