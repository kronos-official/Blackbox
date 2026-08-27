import { mysqlTable, mysqlSchema, AnyMySqlColumn, boolean, index, int, mysqlEnum, uniqueIndex, varchar, bigint, json, timestamp as mysqlTimestamp, text } from "drizzle-orm/mysql-core"
import { sql } from "drizzle-orm"

// The operational code uses JavaScript Dates and booleans. Keep the generated
// schema aligned with that contract while preserving the database columns.
const timestamp = (_options?: { mode?: "string" | "date" }) => mysqlTimestamp({ mode: "date" }) as any;
const tinyint = () => boolean() as any;

export const auditLogs = mysqlTable("auditLogs", {
	id: int().autoincrement().notNull(),
	severity: mysqlEnum(['info','warning','critical']).default('info').notNull(),
	category: varchar({ length: 128 }).notNull(),
	event: varchar({ length: 255 }).notNull(),
	groupId: int(),
	actorTelegramId: bigint({ mode: "number" }),
	subjectTelegramId: bigint({ mode: "number" }),
	requestId: varchar({ length: 96 }),
	details: json(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("audit_logs_created_idx").on(table.createdAt),
	index("audit_logs_group_idx").on(table.groupId, table.createdAt),
]);

export const ownerSiteCredentials = mysqlTable("ownerSiteCredentials", {
	id: int().autoincrement().notNull(),
	username: varchar({ length: 96 }).notNull(),
	passwordHash: varchar({ length: 128 }).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("owner_site_credentials_username_unique").on(table.username),
]);

export const channelListings = mysqlTable("channelListings", {
	id: int().autoincrement().notNull(),
	channelChatId: bigint({ mode: "number" }).notNull(),
	ownerTelegramId: bigint({ mode: "number" }).notNull(),
	requestedDays: int().notNull(),
	starsPerDay: int().default(10).notNull(),
	localCurrencyAmount: int(),
	localCurrencyCode: varchar({ length: 16 }).default('IRR'),
	status: mysqlEnum(['draft','pending_payment','pending_approval','active','paused','expired','rejected','cancelled']).default('draft').notNull(),
	activatedAt: timestamp({ mode: 'string' }),
	expiresAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("channel_listings_status_expiry_idx").on(table.status, table.expiresAt),
	index("channel_listings_owner_idx").on(table.ownerTelegramId),
]);

export const contentLocks = mysqlTable("contentLocks", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	lockType: mysqlEnum(['link','photo','video','voice','audio','sticker','gif','document','forward','mention','hashtag','emoji','phone','location','poll','game','bot','command','english','persian','edited_message','long_message','text','reply','inline_button','profanity','all']).notNull(),
	enabled: tinyint().default(0).notNull(),
	action: mysqlEnum(['delete','warn','mute']).default('delete').notNull(),
	exemptionRole: mysqlEnum(['none','vip','moderator','admin']).default('vip').notNull(),
	updatedByTelegramId: bigint({ mode: "number" }),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("content_locks_group_type_unique").on(table.groupId, table.lockType),
]);

export const cryptoMarketAlertHistory = mysqlTable("cryptoMarketAlertHistory", {
	id: int().autoincrement().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	alertId: int().notNull(),
	assetId: varchar({ length: 128 }).notNull(),
	assetName: varchar({ length: 160 }).notNull(),
	assetSymbol: varchar({ length: 32 }).notNull(),
	triggerType: mysqlEnum(['target_above','target_below']).notNull(),
	priceUsd: varchar({ length: 48 }).notNull(),
	priceToman: varchar({ length: 48 }),
	previousUsd: varchar({ length: 48 }),
	targetPriceUsd: varchar({ length: 48 }).notNull(),
	source: varchar({ length: 48 }).notNull(),
	privateDeliveryRequested: tinyint().default(0).notNull(),
	privateDelivered: tinyint(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("crypto_market_alert_history_user_created_idx").on(table.telegramUserId, table.createdAt),
	index("crypto_market_alert_history_alert_created_idx").on(table.alertId, table.createdAt),
]);

export const cryptoMarketAlertSchedulers = mysqlTable("cryptoMarketAlertSchedulers", {
	id: int().autoincrement().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	intervalMinutes: int().default(15).notNull(),
	scheduleCronTaskUid: varchar({ length: 65 }),
	enabled: tinyint().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("crypto_market_alert_schedulers_user_unique").on(table.telegramUserId),
	index("crypto_market_alert_schedulers_task_uid_idx").on(table.scheduleCronTaskUid),
	index("crypto_market_alert_schedulers_enabled_idx").on(table.enabled),
]);

export const cryptoMarketAlerts = mysqlTable("cryptoMarketAlerts", {
	id: int().autoincrement().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	assetId: varchar({ length: 128 }).notNull(),
	assetName: varchar({ length: 160 }).notNull(),
	assetSymbol: varchar({ length: 32 }).notNull(),
	enabled: tinyint().default(0).notNull(),
	intervalMinutes: int().default(15).notNull(),
	targetPriceUsd: varchar({ length: 48 }).notNull(),
	targetDirection: mysqlEnum(['above','below']).default('above').notNull(),
	privateDeliveryEnabled: tinyint().default(0).notNull(),
	lastObservedUsd: varchar({ length: 48 }),
	lastCheckedAt: timestamp({ mode: 'string' }),
	lastAlertedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("crypto_market_alerts_user_asset_unique").on(table.telegramUserId, table.assetId),
	index("crypto_market_alerts_user_enabled_idx").on(table.telegramUserId, table.enabled),
	index("crypto_market_alerts_due_idx").on(table.enabled, table.lastCheckedAt),
]);

export const cryptoMarketFavorites = mysqlTable("cryptoMarketFavorites", {
	id: int().autoincrement().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	assetId: varchar({ length: 128 }).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("crypto_market_favorites_user_asset_unique").on(table.telegramUserId, table.assetId),
	index("crypto_market_favorites_user_created_idx").on(table.telegramUserId, table.createdAt),
]);

export const customCommands = mysqlTable("customCommands", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	trigger: varchar({ length: 255 }).notNull(),
	response: text().notNull(),
	enabled: tinyint().default(1).notNull(),
	createdByTelegramId: bigint({ mode: "number" }).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("custom_commands_group_trigger_unique").on(table.groupId, table.trigger),
]);

export const filterRules = mysqlTable("filterRules", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	pattern: varchar({ length: 1000 }).notNull(),
	matchType: mysqlEnum(['word','phrase','regex']).default('word').notNull(),
	action: mysqlEnum(['delete','warn','mute','ban']).default('delete').notNull(),
	enabled: tinyint().default(1).notNull(),
	createdByTelegramId: bigint({ mode: "number" }).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("filter_rules_group_idx").on(table.groupId),
]);

export const forcedJoinAcquisitions = mysqlTable("forcedJoinAcquisitions", {
	id: int().autoincrement().notNull(),
	forcedJoinChannelId: int().notNull(),
	verifiedCount: int().default(0).notNull(),
	lastVerifiedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("forced_join_acquisitions_channel_unique").on(table.forcedJoinChannelId),
]);

export const forcedJoinChannels = mysqlTable("forcedJoinChannels", {
	id: int().autoincrement().notNull(),
	groupId: int(),
	channelChatId: bigint({ mode: "number" }).notNull(),
	username: varchar({ length: 128 }),
	title: varchar({ length: 512 }).notNull(),
	inviteUrl: varchar({ length: 1024 }),
	scope: mysqlEnum(['global','group','marketplace']).default('marketplace').notNull(),
	status: mysqlEnum(['pending','active','paused','expired','rejected']).default('pending').notNull(),
	ownerTelegramId: bigint({ mode: "number" }).notNull(),
	listingId: int(),
	requiresAdminVerification: tinyint().default(1).notNull(),
	lastVerifiedAt: timestamp({ mode: 'string' }),
	startsAt: timestamp({ mode: 'string' }),
	expiresAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	buttonLabel: varchar({ length: 64 }),
},
(table) => [
	index("forced_join_channels_chat_scope_unique").on(table.channelChatId, table.scope, table.groupId),
	index("forced_join_channels_status_expiry_idx").on(table.status, table.expiresAt),
]);

export const forcedJoinDailyStats = mysqlTable("forcedJoinDailyStats", {
	id: int().autoincrement().notNull(),
	forcedJoinChannelId: int().notNull(),
	dayKey: varchar({ length: 10 }).notNull(),
	verifiedCount: int().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("forced_join_daily_channel_day_unique").on(table.forcedJoinChannelId, table.dayKey),
	index("forced_join_daily_day_idx").on(table.dayKey),
]);

export const forcedJoinGroupLocks = mysqlTable("forcedJoinGroupLocks", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	locked: tinyint().default(0).notNull(),
	missingChannelIds: json(),
	lastMembershipCheckAt: timestamp({ mode: 'string' }),
	lastPromptMessageId: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("forced_join_group_locks_group_user_unique").on(table.groupId, table.telegramUserId),
	index("forced_join_group_locks_group_locked_idx").on(table.groupId, table.locked),
]);

export const forcedJoinSessions = mysqlTable("forcedJoinSessions", {
	id: int().autoincrement().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	locked: tinyint().default(0).notNull(),
	missingChannelIds: json(),
	lockReason: varchar({ length: 128 }),
	lastMembershipCheckAt: timestamp({ mode: 'string' }),
	lastPromptMessageId: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("forced_join_sessions_user_unique").on(table.telegramUserId),
	index("forced_join_sessions_locked_idx").on(table.locked),
]);

export const globalAdmins = mysqlTable("globalAdmins", {
	id: int().autoincrement().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	grantedByTelegramId: bigint({ mode: "number" }).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("global_admins_tg_id_unique").on(table.telegramUserId),
]);

export const groupAuditEvents = mysqlTable("groupAuditEvents", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	actorTelegramId: bigint({ mode: "number" }),
	subjectTelegramId: bigint({ mode: "number" }),
	action: varchar({ length: 96 }).notNull(),
	source: varchar({ length: 48 }).default('telegram').notNull(),
	outcome: mysqlEnum(['allowed','denied','completed','failed']).notNull(),
	requestId: varchar({ length: 96 }),
	details: json(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("group_audit_events_group_created_idx").on(table.groupId, table.createdAt),
	index("group_audit_events_actor_created_idx").on(table.actorTelegramId, table.createdAt),
	index("group_audit_events_action_created_idx").on(table.action, table.createdAt),
]);

export const groupMemberDailyStats = mysqlTable("groupMemberDailyStats", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	dayKey: varchar({ length: 10 }).notNull(),
	joinedCount: int().default(0).notNull(),
	leftCount: int().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	joinedViaInviteLinkCount: int().default(0).notNull(),
	manuallyAddedCount: int().default(0).notNull(),
	expelledCount: int().default(0).notNull(),
	mutedCount: int().default(0).notNull(),
},
(table) => [
	index("group_member_daily_stats_scope_day_unique").on(table.groupId, table.dayKey),
	index("group_member_daily_stats_group_day_idx").on(table.groupId, table.dayKey),
]);

export const groupMembers = mysqlTable("groupMembers", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	membershipStatus: mysqlEnum(['active','left','kicked','unknown']).default('active').notNull(),
	firstSeenAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	lastSeenAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	lastStatusAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	telegramRole: mysqlEnum(['owner','administrator','member','restricted','unknown']).default('unknown').notNull(),
	kronosTitle: varchar({ length: 64 }),
},
(table) => [
	index("group_members_scope_user_unique").on(table.groupId, table.telegramUserId),
	index("group_members_group_seen_idx").on(table.groupId, table.lastSeenAt),
]);

export const groupPolicyOverrides = mysqlTable("groupPolicyOverrides", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	policyKey: varchar({ length: 96 }).notNull(),
	value: json().notNull(),
	updatedByTelegramId: bigint({ mode: "number" }).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("group_policy_overrides_scope_key_unique").on(table.groupId, table.policyKey),
	index("group_policy_overrides_group_idx").on(table.groupId, table.updatedAt),
]);

export const groupPolicyVersions = mysqlTable("groupPolicyVersions", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	policyKey: varchar({ length: 96 }).notNull(),
	value: json().notNull(),
	previousValue: json(),
	operation: mysqlEnum(['set','rollback']).notNull(),
	sourceVersionId: int(),
	updatedByTelegramId: bigint({ mode: "number" }).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("group_policy_versions_scope_created_idx").on(table.groupId, table.policyKey, table.createdAt),
	index("group_policy_versions_group_idx").on(table.groupId, table.createdAt),
]);

export const groupRecentMessages = mysqlTable("groupRecentMessages", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	messageId: int().notNull(),
	senderTelegramId: bigint({ mode: "number" }),
	observedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	autoDeleteAt: timestamp({ mode: 'string' }),
},
(table) => [
	uniqueIndex("group_recent_messages_group_message_unique").on(table.groupId, table.messageId),
	index("group_recent_messages_group_message_idx").on(table.groupId, table.messageId),
	index("group_recent_messages_auto_delete_idx").on(table.autoDeleteAt),
]);

export const groupRoles = mysqlTable("groupRoles", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	role: mysqlEnum(['group_owner','group_admin','kronos_owner','moderator','vip']).notNull(),
	grantedByTelegramId: bigint({ mode: "number" }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("group_roles_scope_user_role_unique").on(table.groupId, table.telegramUserId, table.role),
	index("group_roles_group_user_idx").on(table.groupId, table.telegramUserId),
]);

/** Explicitly suspends a live Telegram authority from Kronos until owner-led bootstrap restores it. */
export const groupAuthoritySuspensions = mysqlTable("groupAuthoritySuspensions", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	suspendedByTelegramId: bigint({ mode: "number" }).notNull(),
	createdAt: timestamp({ mode: "string" }).default(sql`CURRENT_TIMESTAMP`).notNull(),
},
(table) => [
	uniqueIndex("group_authority_suspensions_group_user_unique").on(table.groupId, table.telegramUserId),
	index("group_authority_suspensions_group_idx").on(table.groupId),
]);

export const groupSettings = mysqlTable("groupSettings", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	welcomeEnabled: tinyint().default(1).notNull(),
	welcomeMessage: text(),
	goodbyeEnabled: tinyint().default(0).notNull(),
	goodbyeMessage: text(),
	warnLimit: int().default(3).notNull(),
	warnAction: mysqlEnum(['mute','ban']).default('mute').notNull(),
	warnMuteMinutes: int().default(0).notNull(),
	antiSpamEnabled: tinyint().default(1).notNull(),
	antiRaidEnabled: tinyint().default(1).notNull(),
	groupLocked: tinyint().default(0).notNull(),
	marketCommandsEnabled: tinyint().default(1).notNull(),
	floodMessageLimit: int().default(7).notNull(),
	floodWindowSeconds: int().default(12).notNull(),
	duplicateMessageLimit: int().default(3).notNull(),
	serviceMessagesEnabled: tinyint().default(1).notNull(),
	rulesText: text(),
	customSettings: json(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	raidModeUntil: timestamp({ mode: 'string' }),
},
(table) => [
	index("group_settings_group_unique").on(table.groupId),
]);

export const globalBotSettings = mysqlTable("globalBotSettings", {
	id: int().autoincrement().notNull(),
	settingKey: varchar({ length: 128 }).notNull(),
	settingValue: text().notNull(),
	valueType: mysqlEnum(["string", "number", "boolean", "json"]).default("string").notNull(),
	updatedByTelegramId: bigint({ mode: "number" }).notNull(),
	createdAt: timestamp({ mode: "string" }).default("CURRENT_TIMESTAMP").notNull(),
	updatedAt: timestamp({ mode: "string" }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("global_bot_settings_key_unique").on(table.settingKey),
]);

export const globalBotTexts = mysqlTable("globalBotTexts", {
	id: int().autoincrement().notNull(),
	textKey: varchar({ length: 160 }).notNull(),
	category: varchar({ length: 64 }).notNull(),
	textValue: text().notNull(),
	enabled: tinyint().default(1).notNull(),
	updatedByTelegramId: bigint({ mode: "number" }).notNull(),
	createdAt: timestamp({ mode: "string" }).default("CURRENT_TIMESTAMP").notNull(),
	updatedAt: timestamp({ mode: "string" }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("global_bot_texts_key_unique").on(table.textKey),
	index("global_bot_texts_category_idx").on(table.category),
]);

export const ownerConfigRevisions = mysqlTable("ownerConfigRevisions", {
	id: int().autoincrement().notNull(),
	version: int().notNull(),
	scope: varchar({ length: 32 }).default("global").notNull(),
	changeSummary: varchar({ length: 512 }).notNull(),
	snapshot: json().notNull(),
	status: mysqlEnum(["draft", "published", "reverted"]).default("draft").notNull(),
	createdByTelegramId: bigint({ mode: "number" }).notNull(),
	createdAt: timestamp({ mode: "string" }).default("CURRENT_TIMESTAMP").notNull(),
},
(table) => [
	index("owner_config_revisions_version_idx").on(table.version),
	index("owner_config_revisions_status_idx").on(table.status, table.createdAt),
]);

export const groupStatisticsReportDeliveries = mysqlTable("groupStatisticsReportDeliveries", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	scheduleCronTaskUid: varchar({ length: 65 }).notNull(),
	reportDate: varchar({ length: 10 }).notNull(),
	frequency: mysqlEnum(['daily','weekly','monthly']).notNull(),
	deliveryKey: varchar({ length: 160 }).notNull(),
	status: mysqlEnum(['pending','delivered','failed']).default('pending').notNull(),
	telegramMessageId: int(),
	errorMessage: varchar({ length: 512 }),
	deliveredAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("group_statistics_report_deliveries_key_unique").on(table.deliveryKey),
	index("group_statistics_report_deliveries_group_date_idx").on(table.groupId, table.reportDate),
	index("group_statistics_report_deliveries_task_uid_idx").on(table.scheduleCronTaskUid),
]);

export const groupStatisticsSchedules = mysqlTable("groupStatisticsSchedules", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	createdByTelegramId: bigint({ mode: "number" }).notNull(),
	frequency: mysqlEnum(['daily','weekly','monthly']).default('daily').notNull(),
	dayOfWeek: int().default(1).notNull(),
	dayOfMonth: int().default(1).notNull(),
	hour: int().default(9).notNull(),
	minute: int().default(0).notNull(),
	timezone: varchar({ length: 64 }).default('Asia/Tehran').notNull(),
	enabled: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	scheduleCronTaskUid: varchar({ length: 65 }),
},
(table) => [
	index("group_statistics_schedules_group_unique").on(table.groupId),
	index("group_statistics_schedules_enabled_idx").on(table.enabled),
	index("group_statistics_schedules_task_uid_idx").on(table.scheduleCronTaskUid),
]);

export const groupUserDailyStats = mysqlTable("groupUserDailyStats", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	dayKey: varchar({ length: 10 }).notNull(),
	messageCount: int().default(0).notNull(),
	addedMemberCount: int().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	photoCount: int().default(0).notNull(),
	videoCount: int().default(0).notNull(),
	documentCount: int().default(0).notNull(),
	audioCount: int().default(0).notNull(),
	stickerCount: int().default(0).notNull(),
	voiceCount: int().default(0).notNull(),
	forwardedMessageCount: int().default(0).notNull(),
	videoNoteCount: int().default(0).notNull(),
	animationCount: int().default(0).notNull(),
	animatedStickerCount: int().default(0).notNull(),
},
(table) => [
	index("group_user_daily_stats_scope_day_unique").on(table.groupId, table.telegramUserId, table.dayKey),
	index("group_user_daily_stats_group_day_idx").on(table.groupId, table.dayKey),
	index("group_user_daily_stats_user_idx").on(table.telegramUserId, table.dayKey),
]);

export const groupUserHourlyStats = mysqlTable("groupUserHourlyStats", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	hourKey: varchar({ length: 13 }).notNull(),
	dayOfWeek: int().notNull(),
	messageCount: int().default(0).notNull(),
	addedMemberCount: int().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("group_user_hourly_stats_scope_hour_unique").on(table.groupId, table.telegramUserId, table.hourKey),
	index("group_user_hourly_stats_group_user_idx").on(table.groupId, table.telegramUserId),
	index("group_user_hourly_stats_day_idx").on(table.dayOfWeek),
]);

export const lockPolicySnapshots = mysqlTable("lockPolicySnapshots", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	profileKey: varchar({ length: 32 }).notNull(),
	snapshot: json().notNull(),
	createdByTelegramId: bigint({ mode: "number" }).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("lock_policy_snapshots_group_unique").on(table.groupId),
]);

export const marketplacePaymentSettings = mysqlTable("marketplacePaymentSettings", {
	id: int().autoincrement().notNull(),
	starsPerDay: int().default(10).notNull(),
	iranRialsPerDay: int(),
	cardRecipientName: varchar({ length: 255 }).default('Forouzan Nemati').notNull(),
	cardNumber: varchar({ length: 32 }).default('6219861915168891').notNull(),
	cardBank: varchar({ length: 128 }).default('Blu Bank').notNull(),
	cryptoWallets: json(),
	updatedByTelegramId: bigint({ mode: "number" }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const moderationActions = mysqlTable("moderationActions", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	actorTelegramId: bigint({ mode: "number" }),
	targetTelegramId: bigint({ mode: "number" }),
	action: mysqlEnum(['ban','kick','mute','unmute','unban','warn','unwarn','delete','lock','unlock','raid_block']).notNull(),
	source: mysqlEnum(['manual','command','automated','scheduler']).notNull(),
	commandAlias: varchar({ length: 64 }),
	reason: text(),
	expiresAt: timestamp({ mode: 'string' }),
	telegramMessageId: int(),
	metadata: json(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	completedAt: timestamp({ mode: 'string' }),
},
(table) => [
	index("moderation_actions_group_created_idx").on(table.groupId, table.createdAt),
	index("moderation_actions_expiry_idx").on(table.expiresAt),
]);

export const moderationNotes = mysqlTable("moderationNotes", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	targetTelegramId: bigint({ mode: "number" }).notNull(),
	authorTelegramId: bigint({ mode: "number" }).notNull(),
	body: text().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("moderation_notes_group_target_idx").on(table.groupId, table.targetTelegramId),
]);

export const ownerAlerts = mysqlTable("ownerAlerts", {
	id: int().autoincrement().notNull(),
	alertType: mysqlEnum(['raid','spam_wave','forced_join_expired','bot_permission_lost','webhook_problem','database_problem','scheduler_failure','payment_approval']).notNull(),
	severity: mysqlEnum(['warning','critical']).notNull(),
	title: varchar({ length: 255 }).notNull(),
	body: text().notNull(),
	relatedEntityType: varchar({ length: 64 }),
	relatedEntityId: int(),
	dedupeKey: varchar({ length: 255 }).notNull(),
	status: mysqlEnum(['pending','sent','failed','acknowledged']).default('pending').notNull(),
	attempts: int().default(0).notNull(),
	lastAttemptAt: timestamp({ mode: 'string' }),
	sentAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("owner_alerts_dedupe_unique").on(table.dedupeKey),
	index("owner_alerts_status_idx").on(table.status, table.createdAt),
]);

export const paymentOrders = mysqlTable("paymentOrders", {
	id: int().autoincrement().notNull(),
	publicId: varchar({ length: 48 }).notNull(),
	listingId: int().notNull(),
	payerTelegramId: bigint({ mode: "number" }).notNull(),
	method: mysqlEnum(['telegram_stars','card_to_card','usdt_manual','doge_manual','shib_manual','dron_manual','ltc_manual']).notNull(),
	status: mysqlEnum(['created','awaiting_payment','receipt_submitted','pending_approval','paid','rejected','expired','refunded','cancelled']).default('created').notNull(),
	amountStars: int(),
	amountMinor: int(),
	currency: varchar({ length: 16 }).notNull(),
	providerReference: varchar({ length: 255 }),
	providerPayload: json(),
	reviewedByTelegramId: bigint({ mode: "number" }),
	reviewedAt: timestamp({ mode: 'string' }),
	expiresAt: timestamp({ mode: 'string' }),
	paidAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("payment_orders_public_id_unique").on(table.publicId),
	index("payment_orders_status_created_idx").on(table.status, table.createdAt),
	index("payment_orders_payer_idx").on(table.payerTelegramId),
]);

export const paymentReceipts = mysqlTable("paymentReceipts", {
	id: int().autoincrement().notNull(),
	paymentOrderId: int().notNull(),
	storageKey: varchar({ length: 1024 }).notNull(),
	mimeType: varchar({ length: 128 }).notNull(),
	originalFilename: varchar({ length: 512 }),
	byteSize: int(),
	submittedByTelegramId: bigint({ mode: "number" }).notNull(),
	submittedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	deletedAt: timestamp({ mode: 'string' }),
},
(table) => [
	index("payment_receipts_order_idx").on(table.paymentOrderId),
]);

export const projectSchedules = mysqlTable("projectSchedules", {
	id: int().autoincrement().notNull(),
	scheduleKey: varchar({ length: 96 }).notNull(),
	scheduleCronTaskUid: varchar({ length: 65 }),
	cronExpression: varchar({ length: 64 }).notNull(),
	callbackPath: varchar({ length: 255 }).notNull(),
	enabled: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("projectSchedules_scheduleKey_unique").on(table.scheduleKey),
	index("projectSchedules_taskUid_idx").on(table.scheduleCronTaskUid),
]);

export const scheduledJobs = mysqlTable("scheduledJobs", {
	id: int().autoincrement().notNull(),
	jobType: mysqlEnum(['listing_expiry','temporary_punishment_expiry','raid_mode_expiry','forced_join_audit','cleanup','alert_retry']).notNull(),
	idempotencyKey: varchar({ length: 255 }).notNull(),
	payload: json().notNull(),
	status: mysqlEnum(['pending','running','completed','failed','cancelled']).default('pending').notNull(),
	runAfter: timestamp({ mode: 'string' }).notNull(),
	attempts: int().default(0).notNull(),
	lastError: text(),
	lockedAt: timestamp({ mode: 'string' }),
	completedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("scheduled_jobs_idempotency_unique").on(table.idempotencyKey),
	index("scheduled_jobs_due_idx").on(table.status, table.runAfter),
]);

export const supportTicketEvents = mysqlTable("supportTicketEvents", {
	id: int().autoincrement().notNull(),
	ticketId: int().notNull(),
	actorTelegramId: bigint({ mode: "number" }).notNull(),
	eventType: mysqlEnum(['created','status_changed','assigned','priority_changed','replied','closed','reopened']).notNull(),
	fromStatus: varchar({ length: 32 }),
	toStatus: varchar({ length: 32 }),
	note: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("support_ticket_events_ticket_idx").on(table.ticketId, table.createdAt),
]);

export const supportTicketMessages = mysqlTable("supportTicketMessages", {
	id: int().autoincrement().notNull(),
	ticketId: int().notNull(),
	authorTelegramId: bigint({ mode: "number" }).notNull(),
	authorRole: mysqlEnum(['user','owner']).notNull(),
	body: text().notNull(),
	attachments: json(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("support_ticket_messages_ticket_idx").on(table.ticketId, table.createdAt),
]);

export const supportTickets = mysqlTable("supportTickets", {
	id: int().autoincrement().notNull(),
	publicId: varchar({ length: 32 }).notNull(),
	requesterTelegramId: bigint({ mode: "number" }).notNull(),
	subject: varchar({ length: 255 }).notNull(),
	category: mysqlEnum(['technical','moderation','payment','account','suggestion','other']).default('technical').notNull(),
	priority: mysqlEnum(['low','normal','high','urgent']).default('normal').notNull(),
	status: mysqlEnum(['open','in_progress','waiting_user','resolved','closed']).default('open').notNull(),
	assignedToTelegramId: bigint({ mode: "number" }),
	lastMessageAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	closedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("support_tickets_public_id_unique").on(table.publicId),
	index("support_tickets_requester_idx").on(table.requesterTelegramId, table.updatedAt),
	index("support_tickets_queue_idx").on(table.status, table.priority, table.updatedAt),
]);

export const telegramGroups = mysqlTable("telegramGroups", {
	id: int().autoincrement().notNull(),
	chatId: bigint({ mode: "number" }).notNull(),
	title: varchar({ length: 512 }).notNull(),
	username: varchar({ length: 128 }),
	ownerTelegramId: bigint({ mode: "number" }),
	language: varchar({ length: 16 }).default('fa').notNull(),
	timezone: varchar({ length: 64 }).default('Asia/Tehran').notNull(),
	status: mysqlEnum(['active','permission_lost','removed','paused']).default('active').notNull(),
	botPermissions: json(),
	installedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	lastActivityAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("telegram_groups_chat_id_unique").on(table.chatId),
	index("telegram_groups_status_idx").on(table.status),
]);

export const telegramUsers = mysqlTable("telegramUsers", {
	id: int().autoincrement().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	username: varchar({ length: 128 }),
	firstName: varchar({ length: 256 }),
	lastName: varchar({ length: 256 }),
	languageCode: varchar({ length: 16 }),
	preferredLocale: varchar({ length: 16 }).default('fa'),
	isBot: tinyint().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	startedBotAt: timestamp({ mode: 'string' }),
	notificationMutes: json(),
	privateNotificationDeliveryEnabled: tinyint().default(0).notNull(),
},
(table) => [
	index("telegram_users_tg_id_unique").on(table.telegramUserId),
]);

export const userNotifications = mysqlTable("userNotifications", {
	id: int().autoincrement().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	eventType: varchar({ length: 96 }).notNull(),
	title: varchar({ length: 255 }).notNull(),
	body: text().notNull(),
	relatedGroupId: int(),
	relatedRole: varchar({ length: 64 }),
	isRead: tinyint().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	readAt: timestamp({ mode: 'string' }),
},
(table) => [
	index("user_notifications_user_idx").on(table.telegramUserId, table.createdAt),
	index("user_notifications_unread_idx").on(table.telegramUserId, table.isRead, table.createdAt),
]);

export const userWarnings = mysqlTable("userWarnings", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	count: int().default(0).notNull(),
	lastReason: text(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("user_warnings_group_user_unique").on(table.groupId, table.telegramUserId),
]);

export const users = mysqlTable("users", {
	id: int().autoincrement().notNull(),
	openId: varchar({ length: 64 }).notNull(),
	name: text(),
	email: varchar({ length: 320 }),
	loginMethod: varchar({ length: 64 }),
	role: mysqlEnum(['user','admin']).default('user').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	lastSignedIn: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("users_openId_unique").on(table.openId),
]);

export const vipProtections = mysqlTable("vipProtections", {
	id: int().autoincrement().notNull(),
	groupId: int().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	protectMute: tinyint().default(1).notNull(),
	protectBan: tinyint().default(1).notNull(),
	protectKick: tinyint().default(1).notNull(),
	protectDelete: tinyint().default(0).notNull(),
	ignoreAntiSpam: tinyint().default(1).notNull(),
	ignoreAntiRaid: tinyint().default(1).notNull(),
	ignoreFilters: tinyint().default(1).notNull(),
	ignoreContentLocks: tinyint().default(1).notNull(),
	ignoreForcedJoin: tinyint().default(1).notNull(),
	notifyBlockedActions: tinyint().default(1).notNull(),
	expiresAt: timestamp({ mode: 'string' }),
	updatedByTelegramId: bigint({ mode: "number" }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("vip_protections_group_user_unique").on(table.groupId, table.telegramUserId),
	index("vip_protections_expiry_idx").on(table.expiresAt),
]);

export const webhookEvents = mysqlTable("webhookEvents", {
	id: int().autoincrement().notNull(),
	updateId: int().notNull(),
	eventType: varchar({ length: 128 }).notNull(),
	status: mysqlEnum(['received','processed','ignored','failed']).default('received').notNull(),
	errorMessage: text(),
	receivedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	processedAt: timestamp({ mode: 'string' }),
},
(table) => [
	index("webhook_events_update_unique").on(table.updateId),
	index("webhook_events_status_idx").on(table.status, table.receivedAt),
]);

export const xtrRateAlertHistory = mysqlTable("xtrRateAlertHistory", {
	id: int().autoincrement().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	alertId: int().notNull(),
	triggerType: mysqlEnum(['change','target_above','target_below']).notNull(),
	priceUsd: varchar({ length: 48 }).notNull(),
	priceToman: varchar({ length: 48 }).notNull(),
	previousUsd: varchar({ length: 48 }),
	targetPriceUsd: varchar({ length: 48 }),
	changeBps: int(),
	source: varchar({ length: 32 }).default('fragment').notNull(),
	privateDeliveryRequested: tinyint().default(0).notNull(),
	privateDelivered: tinyint(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("xtr_rate_alert_history_user_created_idx").on(table.telegramUserId, table.createdAt),
	index("xtr_rate_alert_history_alert_created_idx").on(table.alertId, table.createdAt),
]);

export const xtrRateAlerts = mysqlTable("xtrRateAlerts", {
	id: int().autoincrement().notNull(),
	telegramUserId: bigint({ mode: "number" }).notNull(),
	enabled: tinyint().default(0).notNull(),
	intervalMinutes: int().default(15).notNull(),
	thresholdBps: int().default(500).notNull(),
	scheduleCronTaskUid: varchar({ length: 65 }),
	lastObservedUsd: varchar({ length: 48 }),
	lastCheckedAt: timestamp({ mode: 'string' }),
	lastAlertedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	targetEnabled: tinyint().default(0).notNull(),
	targetPriceUsd: varchar({ length: 48 }),
	targetDirection: mysqlEnum(['above','below']).default('above').notNull(),
	privateDeliveryEnabled: tinyint().default(0).notNull(),
},
(table) => [
	index("xtr_rate_alerts_user_unique").on(table.telegramUserId),
	index("xtr_rate_alerts_enabled_idx").on(table.enabled),
	index("xtr_rate_alerts_task_uid_idx").on(table.scheduleCronTaskUid),
	]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
