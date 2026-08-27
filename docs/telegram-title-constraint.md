# Telegram custom title constraint

Telegram Bot API documentation: https://core.telegram.org/bots/api

The `setChatAdministratorCustomTitle` method applies a custom title to an administrator in a supergroup, provided that the administrator was promoted by the bot. It does not support assigning Telegram-native custom titles to ordinary members. Kronos Guard therefore keeps the native Telegram path for administrators and uses a separate `groupMembers.kronosTitle` field for a Kronos-managed display title on ordinary members, without claiming that Telegram shows a native admin badge.

Additional reference consulted: https://docs.aiogram.dev/en/latest/api/methods/set_chat_administrator_custom_title.html
