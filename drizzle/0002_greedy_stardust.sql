ALTER TABLE `paymentOrders` MODIFY COLUMN `method` enum('telegram_stars','card_to_card','usdt_nowpayments','usdt_manual','doge_manual','shib_manual','dron_manual','ltc_manual') NOT NULL;
UPDATE `paymentOrders` SET `method` = 'usdt_manual' WHERE `method` = 'usdt_nowpayments';
ALTER TABLE `paymentOrders` MODIFY COLUMN `method` enum('telegram_stars','card_to_card','usdt_manual','doge_manual','shib_manual','dron_manual','ltc_manual') NOT NULL;
