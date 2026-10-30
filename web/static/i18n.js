// eurofish translations (English, Russian, Spanish). Loaded synchronously in
// <head>, before app.js. By default the UI follows the language set on the
// system (the browser's preferred languages); a different language can be
// chosen in the sidebar and is remembered in this browser (localStorage).
// Dates, weekday names and amounts are always formatted with the same locale
// as the UI text, so they never show up in another language.
(() => {
  "use strict";

  const SUPPORTED = ["en", "ru", "es"];
  const NATIVE = { en: "English", ru: "Русский", es: "Español" };
  const KEY = "eurofish.lang";

  const DICT = {
    en: {
      "doc.title": "eurofish — calendar budgeting",
      "auth.tagline": "Plan income and expenses on a calendar and see your balance for every day ahead.",
      "auth.signIn": "Sign in",
      "auth.createAccount": "Create account",
      "auth.displayName": "Display name",
      "auth.email": "E-mail",
      "auth.password": "Password",
      "auth.signupDisabled": "Account creation is disabled on this server or for your network.",
      "auth.passwordShort": "Password must have at least 8 characters.",
      "auth.passwordConfirm": "Repeat password",
      "auth.passwordMismatch": "The passwords do not match.",
      "auth.signInAgain": "Please sign in again.",
      "auth.showPassword": "Show password",
      "auth.hidePassword": "Hide password",

      "side.calendars": "Calendars",
      "side.newCalendar": "New calendar",
      "side.theme": "Theme",
      "side.language": "Language",
      "side.signOut": "Sign out",
      "lang.auto": "System",

      "tb.toggleSidebar": "Toggle sidebar",
      "tb.prevMonth": "Previous month",
      "tb.nextMonth": "Next month",
      "tb.today": "Today",
      "tb.share": "Share",
      "tb.settings": "Settings",
      "tb.addTransaction": "Add transaction",
      "tb.addTransactionLabel": "+ Transaction",

      "empty.title": "Create your first calendar",
      "empty.text": "A calendar holds a starting balance and the money that comes in and goes out.",
      "empty.create": "Create calendar",
      "empty.import": "Import from file…",

      "ev.new": "New transaction",
      "ev.edit": "Edit transaction",
      "ev.view": "Transaction",
      "ev.type": "Type",
      "ev.expense": "Expense",
      "ev.income": "Income",
      "ev.title": "Title",
      "ev.amount": "Amount",
      "ev.category": "Category",
      "ev.date": "Date",
      "ev.repeat": "Repeat",
      "rec.none": "Never",
      "rec.daily": "Daily",
      "rec.weekly": "Weekly",
      "rec.biweekly": "Every 2 weeks",
      "rec.weeks": "Every X weeks",
      "rec.monthly": "Monthly",
      "rec.monthly_day": "Monthly on this day number",
      "rec.monthly_nth": "Monthly on this weekday (e.g. first Monday)",
      "rec.quarterly": "Quarterly",
      "rec.yearly": "Yearly",
      "rec.dayN": "Monthly on day {n}",
      "rec.dayNSkips": " (skips months without it)",
      "ev.interval": "Repeat every X weeks",
      "ev.weeksUnit": "weeks",
      "ev.until": "Repeat until (optional)",
      "ev.note": "Note",
      "ev.delete": "Delete",
      "ev.deleteAll": "Delete all repeats",
      "ev.skip": "Remove this day only",
      "ev.errTitle": "Please enter a title.",
      "ev.errAmount": "Please enter an amount, e.g. 49.90",
      "ev.errDate": "Please pick a date.",
      "ev.errInterval": "Please enter how many weeks between repeats (a whole number from 1 to {max}).",
      "ev.confirmDeleteAll": "Delete \"{title}\" and all its repeats?",
      "ev.confirmDelete": "Delete \"{title}\"?",

      "common.cancel": "Cancel",
      "common.save": "Save",
      "common.close": "Close",
      "common.requestFailed": "Request failed ({status})",

      "toast.savedOne": "Saved for this day only",
      "toast.savedAll": "Saved for all repeats",
      "toast.saved": "Saved",
      "toast.deleted": "Deleted",
      "toast.removedDay": "Removed from this day",
      "toast.balanceSet": "Balance set",
      "toast.balanceRemoved": "Set balance removed",

      "scope.title": "Edit repeating transaction",
      "scope.default": "Apply your changes to this day only, or to all repeats?",
      "scope.text": "Apply your changes to \"{title}\" on {day} only, or to all repeats?",
      "scope.hint": "The repeat settings were changed, so the changes can only be applied to all repeats.",
      "scope.one": "This day only",
      "scope.all": "All repeats",

      "day.setBalance": "Set balance",
      "day.add": "+ Transaction",
      "day.balance": "End-of-day balance: {amount}",
      "day.balanceManual": " (set manually, {diff} vs. calculated)",
      "day.nothing": "Nothing planned for this day.",
      "day.aria": "{date}, {count}, balance {amount}",
      "day.ariaManual": " (set manually)",
      "day.tx": { one: "{n} transaction", other: "{n} transactions" },
      "day.balanceManualTitle": "Balance set manually",
      "day.more": "+{n} more",

      "bal.title": "Balance on this day",
      "bal.label": "End-of-day balance",
      "bal.help": "Transactions on this day are already included. The following days continue from this amount.",
      "bal.clear": "Remove set balance",
      "bal.calculated": " · calculated: {amount}",
      "bal.err": "Please enter an amount, e.g. 1250.00 or -40",

      "sum.title": "This month",
      "sum.start": "Start",
      "sum.income": "Income",
      "sum.expenses": "Expenses",
      "sum.balanceSet": "Balance set",
      "sum.end": "End",
      "sum.lowest": "Lowest",

      "menu.label": "Day actions",
      "menu.open": "Open day",
      "menu.addExpense": "Add expense…",
      "menu.addIncome": "Add income…",
      "menu.setBalance": "Set balance on this day…",
      "menu.changeBalance": "Change balance on this day…",
      "menu.removeBalance": "Remove set balance",

      "cal.new": "New calendar",
      "cal.settings": "Calendar settings",
      "cal.name": "Name",
      "cal.currency": "Currency",
      "cal.startBalance": "Starting balance",
      "cal.balanceDate": "Balance date",
      "cal.help": "The starting balance is what you have on the balance date. Everything after it adds up from there.",
      "cal.importTitle": "Import from file",
      "cal.importText": "Create a calendar from a eurofish .json export (settings, transactions, repeats and set balances).",
      "cal.importChoose": "Choose .json file…",
      "cal.delete": "Delete calendar",
      "cal.defaultName": "Household",
      "cal.errBalance": "Starting balance is not a valid amount.",
      "cal.confirmDelete": "Delete \"{name}\" and all its transactions for everyone? This cannot be undone.",
      "cal.ownedBy": "{name} — owned by {owner}",
      "cal.by": "by {owner}",
      "cal.role.owner": "owner",
      "cal.role.editor": "editor",
      "cal.role.viewer": "viewer",

      "share.title": "Share calendar",
      "share.text": "Add people by e-mail. If they do not have a eurofish account on this server yet, the calendar appears for them as soon as they sign up with that address.",
      "share.email": "E-mail",
      "share.access": "Access",
      "share.canEdit": "Can edit",
      "share.canView": "Can view",
      "share.sendTitle": "Send as file",
      "share.sendText": "Export this calendar (settings, transactions, repeats and set balances) as a JSON file, e.g. to send it with Gmail or Telegram.",
      "share.sendFile": "Send file…",
      "share.download": "Download .json",
      "share.add": "Add person",
      "share.loading": "Loading…",
      "share.you": " (you)",
      "share.invited": "invited · gets access after signing up",
      "share.accessFor": "Access for {name}",
      "share.leave": "Leave",
      "share.remove": "Remove",
      "share.cancelInvite": "Cancel",
      "share.role.owner": "owner",
      "share.role.editor": "can edit",
      "share.role.viewer": "can view",
      "share.accessUpdated": "Access updated",
      "share.confirmCancelInvite": "Cancel the invitation for {email}?",
      "share.confirmLeave": "Leave this calendar?",
      "share.confirmRemove": "Remove {name}?",
      "share.granted": "Access granted",
      "share.invitedToast": "Invited — they get access when they sign up with this e-mail",

      "export.downloaded": "Downloaded",
      "export.notAllowed": "Sharing not allowed here — downloaded instead",
      "export.failed": "Export failed",

      "import.tooLarge": "This file is too large to import (max 1 MB).",
      "import.invalidJson": "This file is not a valid JSON file.",
      "import.notExport": "This file is not a eurofish calendar export.",
      "import.done": { one: "Imported \"{name}\" with {n} transaction", other: "Imported \"{name}\" with {n} transactions" },

      "theme.auto": "System (light/dark)",
      "theme.group.Light": "Light",
      "theme.group.Dark": "Dark",
      "theme.cyber-light": "Cyber light",
      "theme.paper": "Paper",
      "theme.pink": "Pink",
      "theme.lavender": "Lavender",
      "theme.cyber-night": "Cyber night",
      "theme.terminal": "Terminal",
      "theme.purple": "Purple",
      "theme.rose-night": "Rose night",
    },

    ru: {
      "doc.title": "eurofish — бюджет в календаре",
      "auth.tagline": "Планируйте доходы и расходы в календаре и смотрите баланс на каждый день вперёд.",
      "auth.signIn": "Войти",
      "auth.createAccount": "Создать аккаунт",
      "auth.displayName": "Имя",
      "auth.email": "E-mail",
      "auth.password": "Пароль",
      "auth.signupDisabled": "Регистрация отключена на этом сервере или для вашей сети.",
      "auth.passwordShort": "Пароль должен содержать не менее 8 символов.",
      "auth.passwordConfirm": "Повторите пароль",
      "auth.passwordMismatch": "Пароли не совпадают.",
      "auth.signInAgain": "Пожалуйста, войдите снова.",
      "auth.showPassword": "Показать пароль",
      "auth.hidePassword": "Скрыть пароль",

      "side.calendars": "Календари",
      "side.newCalendar": "Новый календарь",
      "side.theme": "Тема",
      "side.language": "Язык",
      "side.signOut": "Выйти",
      "lang.auto": "Системный",

      "tb.toggleSidebar": "Показать или скрыть боковую панель",
      "tb.prevMonth": "Предыдущий месяц",
      "tb.nextMonth": "Следующий месяц",
      "tb.today": "Сегодня",
      "tb.share": "Поделиться",
      "tb.settings": "Настройки",
      "tb.addTransaction": "Добавить операцию",
      "tb.addTransactionLabel": "+ Операция",

      "empty.title": "Создайте свой первый календарь",
      "empty.text": "Календарь хранит начальный баланс, а также поступления и расходы.",
      "empty.create": "Создать календарь",
      "empty.import": "Импорт из файла…",

      "ev.new": "Новая операция",
      "ev.edit": "Изменить операцию",
      "ev.view": "Операция",
      "ev.type": "Тип",
      "ev.expense": "Расход",
      "ev.income": "Доход",
      "ev.title": "Название",
      "ev.amount": "Сумма",
      "ev.category": "Категория",
      "ev.date": "Дата",
      "ev.repeat": "Повтор",
      "rec.none": "Никогда",
      "rec.daily": "Ежедневно",
      "rec.weekly": "Еженедельно",
      "rec.biweekly": "Каждые 2 недели",
      "rec.weeks": "Каждые X недель",
      "rec.monthly": "Ежемесячно",
      "rec.monthly_day": "Ежемесячно в это число",
      "rec.monthly_nth": "Ежемесячно в этот день недели (напр. в первый понедельник)",
      "rec.quarterly": "Ежеквартально",
      "rec.yearly": "Ежегодно",
      "rec.dayN": "Ежемесячно {n}-го числа",
      "rec.dayNSkips": " (месяцы без этого числа пропускаются)",
      "ev.interval": "Повторять каждые X недель",
      "ev.weeksUnit": "нед.",
      "ev.until": "Повторять до (необязательно)",
      "ev.note": "Заметка",
      "ev.delete": "Удалить",
      "ev.deleteAll": "Удалить все повторы",
      "ev.skip": "Убрать только этот день",
      "ev.errTitle": "Введите название.",
      "ev.errAmount": "Введите сумму, например 49.90",
      "ev.errDate": "Выберите дату.",
      "ev.errInterval": "Укажите, через сколько недель повторять (целое число от 1 до {max}).",
      "ev.confirmDeleteAll": "Удалить «{title}» и все повторы?",
      "ev.confirmDelete": "Удалить «{title}»?",

      "common.cancel": "Отмена",
      "common.save": "Сохранить",
      "common.close": "Закрыть",
      "common.requestFailed": "Ошибка запроса ({status})",

      "toast.savedOne": "Сохранено только для этого дня",
      "toast.savedAll": "Сохранено для всех повторов",
      "toast.saved": "Сохранено",
      "toast.deleted": "Удалено",
      "toast.removedDay": "Убрано из этого дня",
      "toast.balanceSet": "Баланс задан",
      "toast.balanceRemoved": "Заданный баланс удалён",

      "scope.title": "Изменение повторяющейся операции",
      "scope.default": "Применить изменения только к этому дню или ко всем повторам?",
      "scope.text": "Применить изменения «{title}» только к дню {day} или ко всем повторам?",
      "scope.hint": "Настройки повтора изменены, поэтому изменения можно применить только ко всем повторам.",
      "scope.one": "Только этот день",
      "scope.all": "Все повторы",

      "day.setBalance": "Задать баланс",
      "day.add": "+ Операция",
      "day.balance": "Баланс на конец дня: {amount}",
      "day.balanceManual": " (задан вручную, {diff} к расчётному)",
      "day.nothing": "На этот день ничего не запланировано.",
      "day.aria": "{date}, {count}, баланс {amount}",
      "day.ariaManual": " (задан вручную)",
      "day.tx": { one: "{n} операция", few: "{n} операции", many: "{n} операций", other: "{n} операции" },
      "day.balanceManualTitle": "Баланс задан вручную",
      "day.more": "ещё {n}",

      "bal.title": "Баланс на этот день",
      "bal.label": "Баланс на конец дня",
      "bal.help": "Операции этого дня уже учтены. Следующие дни продолжаются от этой суммы.",
      "bal.clear": "Удалить заданный баланс",
      "bal.calculated": " · расчётный: {amount}",
      "bal.err": "Введите сумму, например 1250.00 или -40",

      "sum.title": "Этот месяц",
      "sum.start": "Начало",
      "sum.income": "Доходы",
      "sum.expenses": "Расходы",
      "sum.balanceSet": "Баланс задан",
      "sum.end": "Конец",
      "sum.lowest": "Минимум",

      "menu.label": "Действия с днём",
      "menu.open": "Открыть день",
      "menu.addExpense": "Добавить расход…",
      "menu.addIncome": "Добавить доход…",
      "menu.setBalance": "Задать баланс на этот день…",
      "menu.changeBalance": "Изменить баланс на этот день…",
      "menu.removeBalance": "Удалить заданный баланс",

      "cal.new": "Новый календарь",
      "cal.settings": "Настройки календаря",
      "cal.name": "Название",
      "cal.currency": "Валюта",
      "cal.startBalance": "Начальный баланс",
      "cal.balanceDate": "Дата баланса",
      "cal.help": "Начальный баланс — это сумма, которая у вас есть на дату баланса. Всё последующее отсчитывается от неё.",
      "cal.importTitle": "Импорт из файла",
      "cal.importText": "Создать календарь из .json-экспорта eurofish (настройки, операции, повторы и заданные балансы).",
      "cal.importChoose": "Выбрать .json-файл…",
      "cal.delete": "Удалить календарь",
      "cal.defaultName": "Семья",
      "cal.errBalance": "Начальный баланс указан неверно.",
      "cal.confirmDelete": "Удалить «{name}» со всеми операциями для всех участников? Это действие нельзя отменить.",
      "cal.ownedBy": "{name} — владелец: {owner}",
      "cal.by": "владелец: {owner}",
      "cal.role.owner": "владелец",
      "cal.role.editor": "редактор",
      "cal.role.viewer": "просмотр",

      "share.title": "Поделиться календарём",
      "share.text": "Добавляйте людей по e-mail. Если у них ещё нет аккаунта eurofish на этом сервере, календарь появится у них сразу после регистрации с этим адресом.",
      "share.email": "E-mail",
      "share.access": "Доступ",
      "share.canEdit": "Может изменять",
      "share.canView": "Только просмотр",
      "share.sendTitle": "Отправить файлом",
      "share.sendText": "Экспортировать календарь (настройки, операции, повторы и заданные балансы) в JSON-файл, например чтобы отправить его через Gmail или Telegram.",
      "share.sendFile": "Отправить файл…",
      "share.download": "Скачать .json",
      "share.add": "Добавить",
      "share.loading": "Загрузка…",
      "share.you": " (вы)",
      "share.invited": "приглашение · доступ появится после регистрации",
      "share.accessFor": "Доступ для {name}",
      "share.leave": "Покинуть",
      "share.remove": "Удалить",
      "share.cancelInvite": "Отменить",
      "share.role.owner": "владелец",
      "share.role.editor": "может изменять",
      "share.role.viewer": "только просмотр",
      "share.accessUpdated": "Доступ обновлён",
      "share.confirmCancelInvite": "Отменить приглашение для {email}?",
      "share.confirmLeave": "Покинуть этот календарь?",
      "share.confirmRemove": "Удалить {name}?",
      "share.granted": "Доступ предоставлен",
      "share.invitedToast": "Приглашение сохранено — доступ появится после регистрации с этим e-mail",

      "export.downloaded": "Скачано",
      "export.notAllowed": "Отправка здесь недоступна — файл скачан",
      "export.failed": "Не удалось экспортировать",

      "import.tooLarge": "Файл слишком большой для импорта (максимум 1 МБ).",
      "import.invalidJson": "Это не JSON-файл или он повреждён.",
      "import.notExport": "Этот файл не является экспортом календаря eurofish.",
      "import.done": {
        one: "Импортирован «{name}»: {n} операция",
        few: "Импортирован «{name}»: {n} операции",
        many: "Импортирован «{name}»: {n} операций",
        other: "Импортирован «{name}»: {n} операции",
      },

      "theme.auto": "Системная (светлая/тёмная)",
      "theme.group.Light": "Светлые",
      "theme.group.Dark": "Тёмные",
      "theme.cyber-light": "Кибер светлая",
      "theme.paper": "Бумага",
      "theme.pink": "Розовая",
      "theme.lavender": "Лавандовая",
      "theme.cyber-night": "Кибер ночь",
      "theme.terminal": "Терминал",
      "theme.purple": "Фиолетовая",
      "theme.rose-night": "Розовая ночь",
    },

    es: {
      "doc.title": "eurofish — presupuesto en calendario",
      "auth.tagline": "Planifica ingresos y gastos en un calendario y consulta tu saldo para cada día futuro.",
      "auth.signIn": "Iniciar sesión",
      "auth.createAccount": "Crear cuenta",
      "auth.displayName": "Nombre visible",
      "auth.email": "Correo electrónico",
      "auth.password": "Contraseña",
      "auth.signupDisabled": "La creación de cuentas está desactivada en este servidor o para tu red.",
      "auth.passwordShort": "La contraseña debe tener al menos 8 caracteres.",
      "auth.passwordConfirm": "Repite la contraseña",
      "auth.passwordMismatch": "Las contraseñas no coinciden.",
      "auth.signInAgain": "Vuelve a iniciar sesión.",
      "auth.showPassword": "Mostrar contraseña",
      "auth.hidePassword": "Ocultar contraseña",

      "side.calendars": "Calendarios",
      "side.newCalendar": "Nuevo calendario",
      "side.theme": "Tema",
      "side.language": "Idioma",
      "side.signOut": "Cerrar sesión",
      "lang.auto": "Sistema",

      "tb.toggleSidebar": "Mostrar u ocultar la barra lateral",
      "tb.prevMonth": "Mes anterior",
      "tb.nextMonth": "Mes siguiente",
      "tb.today": "Hoy",
      "tb.share": "Compartir",
      "tb.settings": "Ajustes",
      "tb.addTransaction": "Añadir movimiento",
      "tb.addTransactionLabel": "+ Movimiento",

      "empty.title": "Crea tu primer calendario",
      "empty.text": "Un calendario guarda un saldo inicial y el dinero que entra y sale.",
      "empty.create": "Crear calendario",
      "empty.import": "Importar desde archivo…",

      "ev.new": "Nuevo movimiento",
      "ev.edit": "Editar movimiento",
      "ev.view": "Movimiento",
      "ev.type": "Tipo",
      "ev.expense": "Gasto",
      "ev.income": "Ingreso",
      "ev.title": "Título",
      "ev.amount": "Importe",
      "ev.category": "Categoría",
      "ev.date": "Fecha",
      "ev.repeat": "Repetir",
      "rec.none": "Nunca",
      "rec.daily": "Diario",
      "rec.weekly": "Semanal",
      "rec.biweekly": "Cada 2 semanas",
      "rec.weeks": "Cada X semanas",
      "rec.monthly": "Mensual",
      "rec.monthly_day": "Mensual en este número de día",
      "rec.monthly_nth": "Mensual en este día de la semana (p. ej. el primer lunes)",
      "rec.quarterly": "Trimestral",
      "rec.yearly": "Anual",
      "rec.dayN": "Mensual el día {n}",
      "rec.dayNSkips": " (omite los meses que no lo tienen)",
      "ev.interval": "Repetir cada X semanas",
      "ev.weeksUnit": "semanas",
      "ev.until": "Repetir hasta (opcional)",
      "ev.note": "Nota",
      "ev.delete": "Eliminar",
      "ev.deleteAll": "Eliminar todas las repeticiones",
      "ev.skip": "Quitar solo este día",
      "ev.errTitle": "Introduce un título.",
      "ev.errAmount": "Introduce un importe, p. ej. 49.90",
      "ev.errDate": "Elige una fecha.",
      "ev.errInterval": "Indica cada cuántas semanas se repite (un número entero de 1 a {max}).",
      "ev.confirmDeleteAll": "¿Eliminar «{title}» y todas sus repeticiones?",
      "ev.confirmDelete": "¿Eliminar «{title}»?",

      "common.cancel": "Cancelar",
      "common.save": "Guardar",
      "common.close": "Cerrar",
      "common.requestFailed": "La solicitud falló ({status})",

      "toast.savedOne": "Guardado solo para este día",
      "toast.savedAll": "Guardado para todas las repeticiones",
      "toast.saved": "Guardado",
      "toast.deleted": "Eliminado",
      "toast.removedDay": "Quitado de este día",
      "toast.balanceSet": "Saldo fijado",
      "toast.balanceRemoved": "Saldo fijado eliminado",

      "scope.title": "Editar movimiento repetido",
      "scope.default": "¿Aplicar los cambios solo a este día o a todas las repeticiones?",
      "scope.text": "¿Aplicar los cambios de «{title}» solo al {day} o a todas las repeticiones?",
      "scope.hint": "Se cambió la configuración de repetición, así que los cambios solo pueden aplicarse a todas las repeticiones.",
      "scope.one": "Solo este día",
      "scope.all": "Todas las repeticiones",

      "day.setBalance": "Fijar saldo",
      "day.add": "+ Movimiento",
      "day.balance": "Saldo al final del día: {amount}",
      "day.balanceManual": " (fijado manualmente, {diff} respecto al calculado)",
      "day.nothing": "No hay nada previsto para este día.",
      "day.aria": "{date}, {count}, saldo {amount}",
      "day.ariaManual": " (fijado manualmente)",
      "day.tx": { one: "{n} movimiento", other: "{n} movimientos" },
      "day.balanceManualTitle": "Saldo fijado manualmente",
      "day.more": "+{n} más",

      "bal.title": "Saldo en este día",
      "bal.label": "Saldo al final del día",
      "bal.help": "Los movimientos de este día ya están incluidos. Los días siguientes continúan desde este importe.",
      "bal.clear": "Quitar saldo fijado",
      "bal.calculated": " · calculado: {amount}",
      "bal.err": "Introduce un importe, p. ej. 1250.00 o -40",

      "sum.title": "Este mes",
      "sum.start": "Inicio",
      "sum.income": "Ingresos",
      "sum.expenses": "Gastos",
      "sum.balanceSet": "Saldo fijado",
      "sum.end": "Final",
      "sum.lowest": "Mínimo",

      "menu.label": "Acciones del día",
      "menu.open": "Abrir día",
      "menu.addExpense": "Añadir gasto…",
      "menu.addIncome": "Añadir ingreso…",
      "menu.setBalance": "Fijar saldo en este día…",
      "menu.changeBalance": "Cambiar saldo en este día…",
      "menu.removeBalance": "Quitar saldo fijado",

      "cal.new": "Nuevo calendario",
      "cal.settings": "Ajustes del calendario",
      "cal.name": "Nombre",
      "cal.currency": "Moneda",
      "cal.startBalance": "Saldo inicial",
      "cal.balanceDate": "Fecha del saldo",
      "cal.help": "El saldo inicial es lo que tienes en la fecha del saldo. Todo lo posterior se suma a partir de ahí.",
      "cal.importTitle": "Importar desde archivo",
      "cal.importText": "Crea un calendario a partir de una exportación .json de eurofish (ajustes, movimientos, repeticiones y saldos fijados).",
      "cal.importChoose": "Elegir archivo .json…",
      "cal.delete": "Eliminar calendario",
      "cal.defaultName": "Hogar",
      "cal.errBalance": "El saldo inicial no es un importe válido.",
      "cal.confirmDelete": "¿Eliminar «{name}» y todos sus movimientos para todos? Esta acción no se puede deshacer.",
      "cal.ownedBy": "{name} — de {owner}",
      "cal.by": "de {owner}",
      "cal.role.owner": "propietario",
      "cal.role.editor": "editor",
      "cal.role.viewer": "lector",

      "share.title": "Compartir calendario",
      "share.text": "Añade personas por correo electrónico. Si aún no tienen una cuenta de eurofish en este servidor, el calendario les aparecerá en cuanto se registren con esa dirección.",
      "share.email": "Correo electrónico",
      "share.access": "Acceso",
      "share.canEdit": "Puede editar",
      "share.canView": "Puede ver",
      "share.sendTitle": "Enviar como archivo",
      "share.sendText": "Exporta este calendario (ajustes, movimientos, repeticiones y saldos fijados) como archivo JSON, p. ej. para enviarlo por Gmail o Telegram.",
      "share.sendFile": "Enviar archivo…",
      "share.download": "Descargar .json",
      "share.add": "Añadir persona",
      "share.loading": "Cargando…",
      "share.you": " (tú)",
      "share.invited": "invitación · obtiene acceso al registrarse",
      "share.accessFor": "Acceso para {name}",
      "share.leave": "Salir",
      "share.remove": "Quitar",
      "share.cancelInvite": "Cancelar",
      "share.role.owner": "propietario",
      "share.role.editor": "puede editar",
      "share.role.viewer": "puede ver",
      "share.accessUpdated": "Acceso actualizado",
      "share.confirmCancelInvite": "¿Cancelar la invitación de {email}?",
      "share.confirmLeave": "¿Salir de este calendario?",
      "share.confirmRemove": "¿Quitar a {name}?",
      "share.granted": "Acceso concedido",
      "share.invitedToast": "Invitación guardada: obtendrá acceso cuando se registre con este correo",

      "export.downloaded": "Descargado",
      "export.notAllowed": "Aquí no se permite compartir; se ha descargado en su lugar",
      "export.failed": "Error al exportar",

      "import.tooLarge": "El archivo es demasiado grande para importarlo (máx. 1 MB).",
      "import.invalidJson": "Este archivo no es un JSON válido.",
      "import.notExport": "Este archivo no es una exportación de calendario de eurofish.",
      "import.done": { one: "Importado «{name}» con {n} movimiento", other: "Importado «{name}» con {n} movimientos" },

      "theme.auto": "Sistema (claro/oscuro)",
      "theme.group.Light": "Claros",
      "theme.group.Dark": "Oscuros",
      "theme.cyber-light": "Ciber claro",
      "theme.paper": "Papel",
      "theme.pink": "Rosa",
      "theme.lavender": "Lavanda",
      "theme.cyber-night": "Ciber noche",
      "theme.terminal": "Terminal",
      "theme.purple": "Morado",
      "theme.rose-night": "Noche rosa",
    },
  };

  // ---------- language selection ----------

  // The languages set on the system, most preferred first.
  function systemLocales() {
    const out = [];
    if (Array.isArray(navigator.languages)) out.push(...navigator.languages);
    if (navigator.language) out.push(navigator.language);
    try { out.push(Intl.DateTimeFormat().resolvedOptions().locale); } catch { /* ignore */ }
    return out.filter((l) => typeof l === "string" && l);
  }

  function primary(tag) { return String(tag).toLowerCase().split(/[-_]/)[0]; }

  function validTag(tag) {
    try { return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0; } catch { return false; }
  }

  // First supported language in the system's preference list (English if none).
  function systemLanguage() {
    for (const tag of systemLocales()) {
      const lang = primary(tag);
      if (SUPPORTED.includes(lang)) return { lang, tag: validTag(tag) ? tag : lang };
    }
    return { lang: "en", tag: "en" };
  }

  function get() {
    try {
      const v = localStorage.getItem(KEY);
      return SUPPORTED.includes(v) ? v : "auto";
    } catch { return "auto"; }
  }

  // The UI language actually in use: "en", "ru" or "es".
  function lang() {
    const pref = get();
    return pref === "auto" ? systemLanguage().lang : pref;
  }

  // BCP 47 locale for dates and numbers; always the same language as the UI
  // text. The system's region is kept when it matches (e.g. es-MX, en-GB).
  function locale() {
    const sys = systemLanguage();
    const l = lang();
    return sys.lang === l ? sys.tag : l;
  }

  // ---------- translation ----------

  function lookup(key) {
    const l = lang();
    if (DICT[l] && Object.prototype.hasOwnProperty.call(DICT[l], key)) return DICT[l][key];
    if (Object.prototype.hasOwnProperty.call(DICT.en, key)) return DICT.en[key];
    return key;
  }

  function fill(s, params) {
    return String(s).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] !== undefined ? String(params[k]) : m));
  }

  function t(key, params) {
    const v = lookup(key);
    if (v && typeof v === "object") return tn(key, (params && params.n) || 0, params);
    return fill(v, params);
  }

  // Plural-aware translation: {n} is the count.
  function tn(key, n, params) {
    const v = lookup(key);
    if (!v || typeof v !== "object") return fill(v, { ...params, n });
    let cat = "other";
    try { cat = new Intl.PluralRules(locale()).select(n); } catch { cat = n === 1 ? "one" : "other"; }
    return fill(v[cat] || v.other, { ...params, n });
  }

  // "Monthly on the first Monday" for the weekday occurrence of a date.
  // ord: 0..3 = first..fourth, 4 = last.
  const RU_WEEKDAY_ACC = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];
  const RU_GENDER = ["n", "m", "m", "f", "m", "f", "f"];
  const RU_ORD = {
    m: ["первый", "второй", "третий", "четвёртый", "последний"],
    f: ["первую", "вторую", "третью", "четвёртую", "последнюю"],
    n: ["первое", "второе", "третье", "четвёртое", "последнее"],
  };
  const ES_ORD = ["primer", "segundo", "tercer", "cuarto", "último"];
  const EN_ORD = ["first", "second", "third", "fourth", "last"];

  function monthlyNthLabel(date) {
    const ord = Math.min(4, Math.floor((date.getDate() - 1) / 7));
    const wd = date.getDay();
    const l = lang();
    if (l === "ru") return `Ежемесячно в ${RU_ORD[RU_GENDER[wd]][ord]} ${RU_WEEKDAY_ACC[wd]}`;
    const name = date.toLocaleDateString(locale(), { weekday: "long" });
    if (l === "es") return `Mensual el ${ES_ORD[ord]} ${name}`;
    return `Monthly on the ${EN_ORD[ord]} ${name}`;
  }

  // ---------- server error messages ----------
  // The API answers in English; known messages are shown in the UI language.

  const SERVER = {
    ru: {
      exact: {
        "sign-up is disabled for your network": "Регистрация для вашей сети отключена",
        "invalid JSON body": "Некорректный запрос",
        "invalid e-mail address": "Некорректный адрес e-mail",
        "display name is too long": "Имя слишком длинное",
        "password must be between 8 and 72 bytes": "Пароль должен быть длиной от 8 до 72 байт",
        "an account with this e-mail already exists": "Аккаунт с этим e-mail уже существует",
        "wrong e-mail or password": "Неверный e-mail или пароль",
        "not signed in": "Вы не вошли в систему",
        "session expired, please sign in again": "Сеанс истёк, войдите снова",
        "you do not have permission for this action": "У вас нет прав на это действие",
        "currency must be a 3-letter ISO code such as EUR": "Валюта должна быть трёхбуквенным кодом ISO, например EUR",
        "role must be editor or viewer": "Роль должна быть «редактор» или «просмотр»",
        "you already own this calendar": "Вы уже владелец этого календаря",
        "this person already has access": "У этого человека уже есть доступ",
        "member not found (the owner's access cannot be changed)": "Участник не найден (доступ владельца изменить нельзя)",
        "only the owner can remove other people": "Удалять других участников может только владелец",
        "member not found (the owner cannot be removed)": "Участник не найден (владельца удалить нельзя)",
        "amount must not be zero": "Сумма не может быть нулевой",
        "until_date must not be before start_date": "Дата окончания повтора не может быть раньше даты операции",
        "this day is not an occurrence of the repeating transaction": "В этот день повторяющейся операции нет",
        "balance is required": "Укажите баланс",
        "the file is not a valid eurofish calendar export (invalid JSON)": "Файл не является корректным экспортом календаря eurofish (неверный JSON)",
        "the file is not a eurofish calendar export": "Файл не является экспортом календаря eurofish",
        "too many attempts, try again in a minute": "Слишком много попыток, повторите через минуту",
        "not found": "Не найдено",
        "already exists": "Уже существует",
        "internal server error": "Внутренняя ошибка сервера",
        "unknown API endpoint": "Неизвестный адрес API",
      },
      fields: {
        title: "название", category: "категория", note: "заметка", name: "название",
        start_date: "дата", until_date: "дата окончания", date: "дата", amount: "сумма",
        balance: "баланс", start_balance: "начальный баланс", "removed day": "убранный день",
        from: "начало", to: "конец",
      },
      where: { calendar: "календарь", transaction: "операция", "set balance": "заданный баланс" },
      dateFormat: "{field}: нужна дата в формате ГГГГ-ММ-ДД",
      outOfRange: "{field}: значение вне допустимого диапазона",
      lengthRange: "{field}: от {min} до {max} символов",
      lengthMax: "{field}: не более {max} символов",
      recurrence: "Недопустимый тип повтора",
      interval: "Интервал повтора должен быть целым числом от 1 до {max} недель",
      range: "Диапазон должен быть от 1 до {max} дней",
      version: "Неподдерживаемая версия экспорта {v}",
      unit: "Неподдерживаемая единица суммы {u}",
      tooManyTx: "Слишком много операций (максимум {max})",
      tooManyBalances: "Слишком много заданных балансов (максимум {max})",
      tooManySkips: "Слишком много убранных дней (максимум {max})",
    },
    es: {
      exact: {
        "sign-up is disabled for your network": "El registro está desactivado para tu red",
        "invalid JSON body": "Solicitud no válida",
        "invalid e-mail address": "Dirección de correo no válida",
        "display name is too long": "El nombre visible es demasiado largo",
        "password must be between 8 and 72 bytes": "La contraseña debe tener entre 8 y 72 bytes",
        "an account with this e-mail already exists": "Ya existe una cuenta con este correo",
        "wrong e-mail or password": "Correo o contraseña incorrectos",
        "not signed in": "No has iniciado sesión",
        "session expired, please sign in again": "La sesión ha caducado; vuelve a iniciar sesión",
        "you do not have permission for this action": "No tienes permiso para esta acción",
        "currency must be a 3-letter ISO code such as EUR": "La moneda debe ser un código ISO de 3 letras, como EUR",
        "role must be editor or viewer": "El rol debe ser editor o lector",
        "you already own this calendar": "Ya eres el propietario de este calendario",
        "this person already has access": "Esta persona ya tiene acceso",
        "member not found (the owner's access cannot be changed)": "Miembro no encontrado (no se puede cambiar el acceso del propietario)",
        "only the owner can remove other people": "Solo el propietario puede quitar a otras personas",
        "member not found (the owner cannot be removed)": "Miembro no encontrado (no se puede quitar al propietario)",
        "amount must not be zero": "El importe no puede ser cero",
        "until_date must not be before start_date": "La fecha final de repetición no puede ser anterior a la fecha del movimiento",
        "this day is not an occurrence of the repeating transaction": "Este día no corresponde a una repetición del movimiento",
        "balance is required": "Indica el saldo",
        "the file is not a valid eurofish calendar export (invalid JSON)": "El archivo no es una exportación válida de calendario de eurofish (JSON no válido)",
        "the file is not a eurofish calendar export": "El archivo no es una exportación de calendario de eurofish",
        "too many attempts, try again in a minute": "Demasiados intentos; inténtalo de nuevo en un minuto",
        "not found": "No encontrado",
        "already exists": "Ya existe",
        "internal server error": "Error interno del servidor",
        "unknown API endpoint": "Dirección de API desconocida",
      },
      fields: {
        title: "título", category: "categoría", note: "nota", name: "nombre",
        start_date: "fecha", until_date: "fecha final", date: "fecha", amount: "importe",
        balance: "saldo", start_balance: "saldo inicial", "removed day": "día quitado",
        from: "desde", to: "hasta",
      },
      where: { calendar: "calendario", transaction: "movimiento", "set balance": "saldo fijado" },
      dateFormat: "{field}: debe ser una fecha con formato AAAA-MM-DD",
      outOfRange: "{field}: fuera de rango",
      lengthRange: "{field}: debe tener entre {min} y {max} caracteres",
      lengthMax: "{field}: debe tener como máximo {max} caracteres",
      recurrence: "Tipo de repetición no válido",
      interval: "El intervalo de repetición debe ser un número entero de 1 a {max} semanas",
      range: "El intervalo debe ser de 1 a {max} días",
      version: "Versión de exportación no compatible {v}",
      unit: "Unidad de importe no compatible {u}",
      tooManyTx: "Demasiados movimientos (máx. {max})",
      tooManyBalances: "Demasiados saldos fijados (máx. {max})",
      tooManySkips: "Demasiados días quitados (máx. {max})",
    },
  };

  function capitalize(s) { return s ? s.charAt(0).toLocaleUpperCase(locale()) + s.slice(1) : s; }

  function serverError(msg) {
    const tr = SERVER[lang()];
    if (!tr || typeof msg !== "string") return msg;
    const field = (f) => tr.fields[f] || f;
    const one = (m) => {
      if (tr.exact[m]) return tr.exact[m];
      let r;
      // "transaction 3: amount must not be zero"
      if ((r = /^(calendar|transaction|set balance)( \d+)?: (.+)$/.exec(m))) {
        const inner = one(r[3]);
        return `${capitalize(tr.where[r[1]] || r[1])}${r[2] || ""}: ${inner.charAt(0).toLocaleLowerCase(locale()) + inner.slice(1)}`;
      }
      if ((r = /^(.+) must be a date in YYYY-MM-DD format$/.exec(m))) return capitalize(fill(tr.dateFormat, { field: field(r[1]) }));
      if ((r = /^(.+) is out of range$/.exec(m))) return capitalize(fill(tr.outOfRange, { field: field(r[1]) }));
      if ((r = /^(.+) must be (\d+)-(\d+) characters$/.exec(m))) return capitalize(fill(tr.lengthRange, { field: field(r[1]), min: r[2], max: r[3] }));
      if ((r = /^(.+) must be at most (\d+) characters$/.exec(m))) return capitalize(fill(tr.lengthMax, { field: field(r[1]), max: r[2] }));
      if (/^recurrence must be one of /.test(m)) return tr.recurrence;
      if ((r = /^interval \(repeat every X weeks\) must be a whole number from 1 to (\d+)$/.exec(m))) return fill(tr.interval, { max: r[1] });
      if ((r = /^the range must be between 1 and (\d+) days$/.exec(m))) return fill(tr.range, { max: r[1] });
      if ((r = /^unsupported export version (-?\d+)$/.exec(m))) return fill(tr.version, { v: r[1] });
      if ((r = /^unsupported amount unit (.+)$/.exec(m))) return fill(tr.unit, { u: r[1] });
      if ((r = /^too many transactions \(max (\d+)\)$/.exec(m))) return fill(tr.tooManyTx, { max: r[1] });
      if ((r = /^too many set balances \(max (\d+)\)$/.exec(m))) return fill(tr.tooManyBalances, { max: r[1] });
      if ((r = /^too many removed days \(max (\d+)\)$/.exec(m))) return fill(tr.tooManySkips, { max: r[1] });
      return m;
    };
    return one(msg);
  }

  // ---------- static page text ----------
  // data-i18n="key" sets the text; data-i18n-attr="aria-label:key;title:key" sets attributes.
  // A key without a translation keeps the English text from index.html instead
  // of showing the raw key (e.g. "auth.passwordConfirm").
  function applyStatic(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!el.hasAttribute("data-i18n-default")) el.setAttribute("data-i18n-default", el.textContent);
      const v = t(key);
      el.textContent = v === key ? el.getAttribute("data-i18n-default") : v;
    });
    scope.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      for (const pair of el.getAttribute("data-i18n-attr").split(";")) {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      }
    });
    document.documentElement.lang = locale();
    document.title = t("doc.title");
  }

  // ---------- changes ----------
  const listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function notify() {
    document.documentElement.lang = locale();
    for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } }
  }

  function set(id) {
    if (!SUPPORTED.includes(id)) id = "auto";
    try {
      if (id === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, id);
    } catch { /* ignore */ }
    notify();
    return get();
  }

  // When following the system, switch along with it if the system language changes.
  window.addEventListener("languagechange", () => { if (get() === "auto") notify(); });

  // Options for the language picker: "System (…)" plus every supported language.
  function list() {
    return [
      { id: "auto", label: `${t("lang.auto")} (${NATIVE[systemLanguage().lang]})` },
      ...SUPPORTED.map((id) => ({ id, label: NATIVE[id] })),
    ];
  }

  document.documentElement.lang = locale();

  window.EurofishI18n = { t, tn, lang, locale, get, set, list, applyStatic, onChange, serverError, monthlyNthLabel, capitalize };
})();
