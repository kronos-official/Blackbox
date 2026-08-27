CREATE TABLE `supportTicketEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticketId` int NOT NULL,
	`actorTelegramId` bigint NOT NULL,
	`eventType` enum('created','status_changed','assigned','priority_changed','replied','closed','reopened') NOT NULL,
	`fromStatus` varchar(32),
	`toStatus` varchar(32),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `supportTicketEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supportTicketMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticketId` int NOT NULL,
	`authorTelegramId` bigint NOT NULL,
	`authorRole` enum('user','owner') NOT NULL,
	`body` text NOT NULL,
	`attachments` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `supportTicketMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supportTickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publicId` varchar(32) NOT NULL,
	`requesterTelegramId` bigint NOT NULL,
	`subject` varchar(255) NOT NULL,
	`category` enum('technical','moderation','payment','account','suggestion','other') NOT NULL DEFAULT 'technical',
	`priority` enum('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
	`status` enum('open','in_progress','waiting_user','resolved','closed') NOT NULL DEFAULT 'open',
	`assignedToTelegramId` bigint,
	`lastMessageAt` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supportTickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `support_tickets_public_id_unique` UNIQUE(`publicId`)
);
--> statement-breakpoint
CREATE INDEX `support_ticket_events_ticket_idx` ON `supportTicketEvents` (`ticketId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `support_ticket_messages_ticket_idx` ON `supportTicketMessages` (`ticketId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `support_tickets_requester_idx` ON `supportTickets` (`requesterTelegramId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `support_tickets_queue_idx` ON `supportTickets` (`status`,`priority`,`updatedAt`);