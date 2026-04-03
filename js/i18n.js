/* ═══════════════════════════════════════════════════════════════════════════
   I18N SERVICE — Family FinTrack
   Sistema de internacionalização completo.

   Fluxo:
     1. Carrega do Supabase tabela `i18n_translations` (ou cache local)
     2. Escolhe idioma: user pref → browser → 'pt' (fallback)
     3. t(key, vars?) → string traduzida com interpolação {{var}}
     4. Troca de idioma: i18n.setLanguage(lang) → re-renderiza UI dinâmica

   Idiomas suportados de fábrica: pt (padrão), en, es, fr
   Novos idiomas: só adicionar coluna na tabela — zero mudanças no código.

   Dependências: sb (Supabase client via supabase.js), state (state.js)
   Deve ser carregado APÓS supabase.js e state.js, ANTES de app.js.
═══════════════════════════════════════════════════════════════════════════ */

// ── Constantes ──────────────────────────────────────────────────────────────
const I18N_DEFAULT_LANG   = 'pt';
const I18N_SUPPORTED      = ['pt', 'en', 'es', 'fr'];
const I18N_CACHE_KEY      = 'fintrack_i18n_cache';
const I18N_CACHE_LANG_KEY = 'fintrack_i18n_lang';
const I18N_CACHE_TTL_MS   = 60 * 60 * 1000; // 1h


// ── Dicionário embutido — funciona sem banco de dados ────────────────────────
// Garante que os labels do nav e da tela de login aparecem traduzidos mesmo
// quando a tabela i18n_translations ainda não existe no Supabase.
// Formato: { chave: { pt, en, es, fr } }
const _I18N_BUILTIN = {
  // Navegação
  'nav.dashboard':        {pt:'Início',        en:'Home',          es:'Inicio',          fr:'Accueil'},
  'nav.transactions':     {pt:'Transações',    en:'Transactions',  es:'Transacciones',   fr:'Transactions'},
  'nav.accounts':         {pt:'Contas',        en:'Accounts',      es:'Cuentas',         fr:'Comptes'},
  'nav.reports':          {pt:'Relatórios',    en:'Reports',       es:'Informes',        fr:'Rapports'},
  'nav.budgets':          {pt:'Orçamentos',    en:'Budgets',       es:'Presupuestos',    fr:'Budgets'},
  'nav.categories':       {pt:'Categorias',    en:'Categories',    es:'Categorías',      fr:'Catégories'},
  'nav.payees':           {pt:'Beneficiários', en:'Payees',        es:'Beneficiarios',   fr:'Bénéficiaires'},
  'nav.scheduled':        {pt:'Programados',   en:'Scheduled',     es:'Programados',     fr:'Programmés'},
  'nav.grocery':          {pt:'Mercado',       en:'Grocery',       es:'Mercado',         fr:'Courses'},
  'nav.prices':           {pt:'Preços',        en:'Prices',        es:'Precios',         fr:'Prix'},
  'nav.investments':      {pt:'Investimentos', en:'Investments',   es:'Inversiones',     fr:'Investissements'},
  'nav.ai_insights':      {pt:'AI Insights',   en:'AI Insights',   es:'Perspectivas IA', fr:'Aperçus IA'},
  'nav.dreams':           {pt:'Sonhos',         en:'Dreams',        es:'Sueños',           fr:'Rêves'},
  'nav.more':             {pt:'Mais',           en:'More',          es:'Más',              fr:'Plus'},
  // Seções do sidebar
  'nav.section_main':     {pt:'Principal',     en:'Main',          es:'Principal',       fr:'Principal'},
  'nav.section_analysis': {pt:'Análise',       en:'Analysis',      es:'Análisis',        fr:'Analyse'},
  'nav.section_planning': {pt:'Planejamento',  en:'Planning',      es:'Planificación',   fr:'Planification'},
  'nav.section_data':     {pt:'Cadastros',     en:'Records',       es:'Registros',       fr:'Enregistrements'},
  'nav.section_modules':  {pt:'Módulos',       en:'Modules',       es:'Módulos',         fr:'Modules'},
  // Autenticação
  'auth.tagline':          {pt:'Família inteligente, Finanças sob controle', en:'Smart family, Finances under control', es:'Familia inteligente, Finanzas bajo control', fr:'Famille intelligente, Finances maîtrisées'},
  'auth.login_tab_pwd':    {pt:'🔑 Senha',      en:'🔑 Password',   es:'🔑 Contraseña',   fr:'🔑 Mot de passe'},
  'auth.login_tab_magic':  {pt:'✉️ Link por E-mail', en:'✉️ Email Link', es:'✉️ Enlace por correo', fr:'✉️ Lien par e-mail'},
  'auth.label_email':      {pt:'E-mail',        en:'Email',         es:'Correo',          fr:'E-mail'},
  'auth.label_password':   {pt:'Senha',         en:'Password',      es:'Contraseña',      fr:'Mot de passe'},
  'auth.remember_me':      {pt:'Salvar meu usuário', en:'Save my username', es:'Guardar mi usuario', fr:'Enregistrer mon utilisateur'},
  'auth.btn_enter':        {pt:'Entrar',        en:'Sign In',       es:'Ingresar',        fr:'Se connecter'},
  'auth.forgot_password':  {pt:'Esqueci minha senha', en:'Forgot my password', es:'Olvidé mi contraseña', fr:'Mot de passe oublié'},
  'auth.no_account':       {pt:'Não tem conta?', en:'No account?',  es:'¿No tienes cuenta?', fr:'Pas de compte ?'},
  'auth.request_access':   {pt:'Solicitar acesso', en:'Request access', es:'Solicitar acceso', fr:"Demander l\'accès"},
  'auth.btn_send_link':    {pt:'✉️ Enviar Link de Acesso', en:'✉️ Send Access Link', es:'✉️ Enviar enlace', fr:'✉️ Envoyer le lien'},
  'auth.btn_send_recovery':{pt:'Enviar Link de Recuperação', en:'Send Recovery Link', es:'Enviar enlace de recuperación', fr:'Envoyer le lien de récupération'},
  'auth.btn_set_password': {pt:'Salvar Nova Senha', en:'Save New Password', es:'Guardar nueva contraseña', fr:'Enregistrer le mot de passe'},
  'auth.btn_set_enter':    {pt:'Definir Senha e Entrar', en:'Set Password & Sign In', es:'Definir contraseña e ingresar', fr:'Définir le mot de passe et se connecter'},
  // Cadastro
  'register.btn_submit':   {pt:'Enviar Solicitação', en:'Submit Request', es:'Enviar solicitud', fr:'Envoyer la demande'},
  // Títulos de páginas
  'page.dashboard':        {pt:'Dashboard',     en:'Dashboard',     es:'Panel',           fr:'Tableau de bord'},
  'page.transactions':     {pt:'Transações',    en:'Transactions',  es:'Transacciones',   fr:'Transactions'},
  'page.accounts':         {pt:'Contas',        en:'Accounts',      es:'Cuentas',         fr:'Comptes'},
  'page.reports':          {pt:'Relatórios',    en:'Reports',       es:'Informes',        fr:'Rapports'},
  'page.budgets':          {pt:'Orçamentos',    en:'Budgets',       es:'Presupuestos',    fr:'Budgets'},
  'page.categories':       {pt:'Categorias',    en:'Categories',    es:'Categorías',      fr:'Catégories'},
  'page.payees':           {pt:'Beneficiários', en:'Payees',        es:'Beneficiarios',   fr:'Bénéficiaires'},
  'page.scheduled':        {pt:'Programados',   en:'Scheduled',     es:'Programados',     fr:'Programmés'},
  'page.investments':      {pt:'Investimentos', en:'Investments',   es:'Inversiones',     fr:'Investissements'},
  'page.prices':           {pt:'Preços',        en:'Prices',        es:'Precios',         fr:'Prix'},
  'page.ai_insights':      {pt:'🤖 AI Insights', en:'🤖 AI Insights', es:'🤖 Perspectivas IA', fr:'🤖 Aperçus IA'},
  'page.grocery':          {pt:'🛒 Mercado',    en:'🛒 Grocery',    es:'🛒 Mercado',       fr:'🛒 Courses'},
  'page.import':           {pt:'Importar / Backup', en:'Import / Backup', es:'Importar / Respaldo', fr:'Importer / Sauvegarde'},
  'page.settings':         {pt:'Configurações', en:'Settings',      es:'Configuración',   fr:'Paramètres'},
  'page.translations':     {pt:'Traduções',     en:'Translations',  es:'Traducciones',    fr:'Traductions'},

  // ── Common UI labels ─────────────────────────────────────────────────────
  'ui.save':          {pt:'Salvar',         en:'Save',           es:'Guardar',          fr:'Enregistrer'},
  'ui.cancel':        {pt:'Cancelar',       en:'Cancel',         es:'Cancelar',         fr:'Annuler'},
  'ui.close':         {pt:'Fechar',         en:'Close',          es:'Cerrar',           fr:'Fermer'},
  'ui.add':           {pt:'Adicionar',      en:'Add',            es:'Agregar',          fr:'Ajouter'},
  'ui.edit':          {pt:'Editar',         en:'Edit',           es:'Editar',           fr:'Modifier'},
  'ui.delete':        {pt:'Excluir',        en:'Delete',         es:'Eliminar',         fr:'Supprimer'},
  'ui.confirm':       {pt:'Confirmar',      en:'Confirm',        es:'Confirmar',        fr:'Confirmer'},
  'ui.search':        {pt:'Buscar',         en:'Search',         es:'Buscar',           fr:'Rechercher'},
  'ui.filter':        {pt:'Filtrar',        en:'Filter',         es:'Filtrar',          fr:'Filtrer'},
  'ui.export':        {pt:'Exportar',       en:'Export',         es:'Exportar',         fr:'Exporter'},
  'ui.import':        {pt:'Importar',       en:'Import',         es:'Importar',         fr:'Importer'},
  'ui.back':          {pt:'Voltar',         en:'Back',           es:'Volver',           fr:'Retour'},
  'ui.new':           {pt:'Novo',           en:'New',            es:'Nuevo',            fr:'Nouveau'},
  'ui.new_f':         {pt:'Nova',           en:'New',            es:'Nueva',            fr:'Nouvelle'},
  'ui.loading':       {pt:'Carregando…',   en:'Loading…',       es:'Cargando…',        fr:'Chargement…'},
  'ui.yes':           {pt:'Sim',            en:'Yes',            es:'Sí',               fr:'Oui'},
  'ui.no':            {pt:'Não',            en:'No',             es:'No',               fr:'Non'},
  'ui.total':         {pt:'Total',          en:'Total',          es:'Total',            fr:'Total'},
  'ui.all':           {pt:'Todos',          en:'All',            es:'Todos',            fr:'Tous'},
  'ui.all_f':         {pt:'Todas',          en:'All',            es:'Todas',            fr:'Toutes'},
  'ui.none':          {pt:'Nenhum',         en:'None',           es:'Ninguno',          fr:'Aucun'},
  'ui.optional':      {pt:'Opcional',       en:'Optional',       es:'Opcional',         fr:'Optionnel'},
  'ui.required':      {pt:'Obrigatório',    en:'Required',       es:'Obligatorio',      fr:'Obligatoire'},
  'ui.today':         {pt:'Hoje',           en:'Today',          es:'Hoy',              fr:"Aujourd'hui"},
  'ui.month':         {pt:'Mês',            en:'Month',          es:'Mes',              fr:'Mois'},
  'ui.year':          {pt:'Ano',            en:'Year',           es:'Año',              fr:'Année'},
  'ui.date':          {pt:'Data',           en:'Date',           es:'Fecha',            fr:'Date'},
  'ui.name':          {pt:'Nome',           en:'Name',           es:'Nombre',           fr:'Nom'},
  'ui.description':   {pt:'Descrição',      en:'Description',    es:'Descripción',      fr:'Description'},
  'ui.amount':        {pt:'Valor',          en:'Amount',         es:'Monto',            fr:'Montant'},
  'ui.balance':       {pt:'Saldo',          en:'Balance',        es:'Saldo',            fr:'Solde'},
  'ui.actions':       {pt:'Ações',          en:'Actions',        es:'Acciones',         fr:'Actions'},
  'ui.status':        {pt:'Status',         en:'Status',         es:'Estado',           fr:'Statut'},
  'ui.type':          {pt:'Tipo',           en:'Type',           es:'Tipo',             fr:'Type'},
  'ui.category':      {pt:'Categoria',      en:'Category',       es:'Categoría',        fr:'Catégorie'},
  'ui.account':       {pt:'Conta',          en:'Account',        es:'Cuenta',           fr:'Compte'},
  'ui.payee':         {pt:'Beneficiário',   en:'Payee',          es:'Beneficiario',     fr:'Bénéficiaire'},
  'ui.notes':         {pt:'Observações',    en:'Notes',          es:'Notas',            fr:'Notes'},
  'ui.currency':      {pt:'Moeda',          en:'Currency',       es:'Moneda',           fr:'Devise'},
  'ui.manage':        {pt:'Gerenciar',      en:'Manage',         es:'Gestionar',        fr:'Gérer'},
  'ui.details':       {pt:'Detalhes',       en:'Details',        es:'Detalles',         fr:'Détails'},
  'ui.select':        {pt:'Selecione',      en:'Select',         es:'Seleccione',       fr:'Sélectionner'},
  'ui.period':        {pt:'Período',        en:'Period',         es:'Período',          fr:'Période'},
  'ui.preview':       {pt:'Prévia',         en:'Preview',        es:'Vista previa',     fr:'Aperçu'},
  'ui.generate':      {pt:'Gerar',          en:'Generate',       es:'Generar',          fr:'Générer'},
  'ui.send':          {pt:'Enviar',         en:'Send',           es:'Enviar',           fr:'Envoyer'},
  'ui.view_all':      {pt:'Ver tudo',       en:'View all',       es:'Ver todo',         fr:'Voir tout'},

  // ── Transactions ──────────────────────────────────────────────────────────
  'tx.title':         {pt:'Lançamentos',    en:'Transactions',   es:'Transacciones',    fr:'Transactions'},
  'tx.income':        {pt:'Receita',        en:'Income',         es:'Ingreso',          fr:'Revenu'},
  'tx.expense':       {pt:'Despesa',        en:'Expense',        es:'Gasto',            fr:'Dépense'},
  'tx.transfer':      {pt:'Transferência',  en:'Transfer',       es:'Transferencia',    fr:'Virement'},
  'tx.all_months':    {pt:'Todos os meses', en:'All months',     es:'Todos los meses',  fr:'Tous les mois'},
  'tx.all_accounts':  {pt:'Todas as contas',en:'All accounts',   es:'Todas las cuentas',fr:'Tous les comptes'},
  'tx.all_categories':{pt:'Todas',          en:'All',            es:'Todas',            fr:'Toutes'},
  'tx.all_payees':    {pt:'Todos',          en:'All',            es:'Todos',            fr:'Tous'},
  'tx.all_types':     {pt:'Todos os tipos', en:'All types',      es:'Todos los tipos',  fr:'Tous les types'},
  'tx.confirmed':     {pt:'Confirmadas',    en:'Confirmed',      es:'Confirmadas',      fr:'Confirmées'},
  'tx.pending':       {pt:'Pendentes',      en:'Pending',        es:'Pendientes',       fr:'En attente'},
  'tx.empty':         {pt:'Nenhuma transação encontrada',en:'No transactions found',es:'No se encontraron transacciones',fr:'Aucune transaction trouvée'},
  'tx.col_date':      {pt:'Data ⇅',         en:'Date ⇅',         es:'Fecha ⇅',          fr:'Date ⇅'},
  'tx.col_desc':      {pt:'Descrição',      en:'Description',    es:'Descripción',      fr:'Description'},
  'tx.col_account':   {pt:'Conta',          en:'Account',        es:'Cuenta',           fr:'Compte'},
  'tx.col_amount':    {pt:'Valor',          en:'Amount',         es:'Monto',            fr:'Montant'},
  'tx.col_actions':   {pt:'Ações',          en:'Actions',        es:'Acciones',         fr:'Actions'},
  'tx.prev_page':     {pt:'‹ Anterior',     en:'‹ Previous',     es:'‹ Anterior',       fr:'‹ Précédent'},
  'tx.next_page':     {pt:'Próxima ›',      en:'Next ›',         es:'Siguiente ›',      fr:'Suivant ›'},
  'tx.date_today':    {pt:'Hoje',           en:'Today',          es:'Hoy',              fr:"Aujourd'hui"},
  'tx.date_yesterday':{pt:'Ontem',          en:'Yesterday',      es:'Ayer',             fr:'Hier'},
  'tx.confirmed_section':{pt:'CONFIRMADAS', en:'CONFIRMED',      es:'CONFIRMADAS',      fr:'CONFIRMÉES'},
  'tx.pending_section':  {pt:'PENDENTES',   en:'PENDING',        es:'PENDIENTES',       fr:'EN ATTENTE'},
  'tx.no_transactions':  {pt:'Nenhuma transação encontrada', en:'No transactions found', es:'Sin transacciones encontradas', fr:'Aucune transaction trouvée'},
  'tx.group_by_account': {pt:'Agrupar por conta', en:'Group by account', es:'Agrupar por cuenta', fr:'Grouper par compte'},
  'tx.view_flat':     {pt:'Lista',          en:'List',           es:'Lista',            fr:'Liste'},
  'tx.view_grouped':  {pt:'Agrupado',       en:'Grouped',        es:'Agrupado',         fr:'Groupé'},
  'tx.balance_adjustment': {pt:'Ajuste de Saldo', en:'Balance Adjustment', es:'Ajuste de saldo', fr:'Ajustement de solde'},
  'tx.is_transfer':   {pt:'Transferência',  en:'Transfer',       es:'Transferencia',    fr:'Virement'},
  'tx.is_card_payment':{pt:'Pagamento de fatura', en:'Card payment', es:'Pago de factura', fr:'Paiement de facture'},
  'tx.new':           {pt:'+ Nova Transação',en:'+ New Transaction',es:'+ Nueva transacción',fr:'+ Nouvelle transaction'},
  'tx.income_tab':    {pt:'+ Receita',      en:'+ Income',       es:'+ Ingreso',        fr:'+ Revenu'},
  'tx.expense_tab':   {pt:'+ Despesa',      en:'+ Expense',      es:'+ Gasto',          fr:'+ Dépense'},
  'tx.transfer_tab':  {pt:'+ Transferência',en:'+ Transfer',     es:'+ Transferencia',  fr:'+ Virement'},

  // ── Accounts ──────────────────────────────────────────────────────────────
  'acct.title':       {pt:'Contas',         en:'Accounts',       es:'Cuentas',          fr:'Comptes'},
  'acct.new':         {pt:'Nova Conta',     en:'New Account',    es:'Nueva cuenta',     fr:'Nouveau compte'},
  'acct.balance':     {pt:'Saldo',          en:'Balance',        es:'Saldo',            fr:'Solde'},
  'acct.empty':       {pt:'Nenhuma conta encontrada',en:'No accounts found',es:'No se encontraron cuentas',fr:'Aucun compte trouvé'},
  'acct.no_group':    {pt:'Sem grupo',      en:'No group',       es:'Sin grupo',        fr:'Sans groupe'},
  'acct.total':       {pt:'Total:',         en:'Total:',         es:'Total:',           fr:'Total:'},
  'acct.group_new':   {pt:'Novo Grupo',     en:'New Group',      es:'Nuevo grupo',      fr:'Nouveau groupe'},
  'acct.type_corrente':    {pt:'Conta Corrente',   en:'Checking',        es:'Cuenta corriente',  fr:'Compte courant'},
  'acct.type_poupanca':    {pt:'Poupança',         en:'Savings',         es:'Ahorros',           fr:'Épargne'},
  'acct.type_cartao_credito':{pt:'Cartão de Crédito',en:'Credit Card',   es:'Tarjeta de crédito',fr:'Carte de crédit'},
  'acct.type_investimento': {pt:'Investimento',    en:'Investment',      es:'Inversión',         fr:'Investissement'},
  'acct.type_carteira':    {pt:'Carteira/Dinheiro',en:'Wallet/Cash',     es:'Cartera/Efectivo',  fr:'Portefeuille/Espèces'},
  'acct.type_outro':       {pt:'Outro',            en:'Other',           es:'Otro',              fr:'Autre'},
  'acct.best_purchase_day':{pt:'Melhor dia de compra',en:'Best purchase day',es:'Mejor día de compra',fr:"Meilleur jour d'achat"},
  'acct.due_day':          {pt:'Dia de vencimento',en:'Due day',         es:'Día de vencimiento',fr:"Jour d'échéance"},
  'acct.initial_balance':  {pt:'Saldo inicial',    en:'Initial balance', es:'Saldo inicial',     fr:'Solde initial'},
  'acct.is_favorite':      {pt:'Conta favorita',   en:'Favorite account',es:'Cuenta favorita',   fr:'Compte favori'},

  // ── Dashboard ─────────────────────────────────────────────────────────────
  'dash.income':      {pt:'Receitas',       en:'Income',         es:'Ingresos',         fr:'Revenus'},
  'dash.expense':     {pt:'Despesas',       en:'Expenses',       es:'Gastos',           fr:'Dépenses'},
  'dash.balance':     {pt:'Saldo',          en:'Balance',        es:'Saldo',            fr:'Solde'},
  'dash.all_accounts':{pt:'Todas as contas',en:'All accounts',   es:'Todas las cuentas',fr:'Tous les comptes'},
  'dash.all_members': {pt:'Família (todos)',en:'Family (all)',   es:'Familia (todos)',   fr:'Famille (tous)'},
  'dash.recent_tx':   {pt:'Lançamentos Recentes',en:'Recent Transactions',es:'Transacciones recientes',fr:'Transactions récentes'},
  'dash.fav_cats':    {pt:'Categorias Favoritas',en:'Favorite Categories',es:'Categorías favoritas',fr:'Catégories favorites'},
  'dash.empty_tx':    {pt:'Nenhuma transação',en:'No transactions',es:'Sin transacciones',fr:'Aucune transaction'},
  'dash.view_all':    {pt:'Ver tudo →',     en:'View all →',     es:'Ver todo →',       fr:'Voir tout →'},
  'dash.manage':      {pt:'Gerenciar',      en:'Manage',         es:'Gestionar',        fr:'Gérer'},

  // ── Reports ───────────────────────────────────────────────────────────────
  'rpt.income':       {pt:'Receitas',       en:'Income',         es:'Ingresos',         fr:'Revenus'},
  'rpt.expense':      {pt:'Despesas',       en:'Expenses',       es:'Gastos',           fr:'Dépenses'},
  'rpt.balance':      {pt:'Saldo',          en:'Balance',        es:'Saldo',            fr:'Solde'},
  'rpt.transactions': {pt:'Transações',     en:'Transactions',   es:'Transacciones',    fr:'Transactions'},
  'rpt.avg_ticket':   {pt:'Ticket médio',   en:'Avg ticket',     es:'Ticket promedio',  fr:'Ticket moyen'},
  'rpt.all':          {pt:'Todas',          en:'All',            es:'Todas',            fr:'Toutes'},
  'rpt.all_m':        {pt:'Todos',          en:'All',            es:'Todos',            fr:'Tous'},
  'rpt.period_month': {pt:'Mês',            en:'Month',          es:'Mes',              fr:'Mois'},
  'rpt.period_quarter':{pt:'Trimestre',     en:'Quarter',        es:'Trimestre',        fr:'Trimestre'},
  'rpt.period_year':  {pt:'Ano',            en:'Year',           es:'Año',              fr:'Année'},
  'rpt.period_last12':{pt:'Últimos 12 meses',en:'Last 12 months',es:'Últimos 12 meses', fr:'12 derniers mois'},
  'rpt.period_custom':{pt:'Personalizado',  en:'Custom',         es:'Personalizado',    fr:'Personnalisé'},
  'rpt.by_category':  {pt:'Por Categoria',  en:'By Category',    es:'Por categoría',    fr:'Par catégorie'},
  'rpt.by_month':     {pt:'Por Mês',        en:'By Month',       es:'Por mes',          fr:'Par mois'},
  'rpt.forecast':     {pt:'Previsão',       en:'Forecast',       es:'Previsión',        fr:'Prévision'},

  // ── Budgets ───────────────────────────────────────────────────────────────
  'bgt.title':        {pt:'Orçamentos',     en:'Budgets',        es:'Presupuestos',     fr:'Budgets'},
  'bgt.new':          {pt:'Novo Orçamento', en:'New Budget',     es:'Nuevo presupuesto',fr:'Nouveau budget'},
  'bgt.used':         {pt:'Utilizado',      en:'Used',           es:'Utilizado',        fr:'Utilisé'},
  'bgt.remaining':    {pt:'Restante',       en:'Remaining',      es:'Restante',         fr:'Restant'},
  'bgt.empty':        {pt:'Nenhum orçamento definido',en:'No budgets defined',es:'Sin presupuestos definidos',fr:'Aucun budget défini'},
  'bgt.over':         {pt:'Excedido',       en:'Over budget',    es:'Excedido',         fr:'Dépassé'},

  // ── Categories ────────────────────────────────────────────────────────────
  'cat.title':        {pt:'Categorias',     en:'Categories',     es:'Categorías',       fr:'Catégories'},
  'cat.new':          {pt:'Nova Categoria', en:'New Category',   es:'Nueva categoría',  fr:'Nouvelle catégorie'},
  'cat.parent':       {pt:'Categoria Pai',  en:'Parent Category',es:'Categoría padre',  fr:'Catégorie parente'},
  'cat.empty':        {pt:'Nenhuma categoria',en:'No categories',es:'Sin categorías',   fr:'Aucune catégorie'},
  'cat.income_cats':  {pt:'Categorias de Receita',en:'Income categories',es:'Categorías de ingreso',fr:'Catégories de revenu'},
  'cat.expense_cats': {pt:'Categorias de Despesa',en:'Expense categories',es:'Categorías de gasto',fr:'Catégories de dépense'},

  // ── Payees ────────────────────────────────────────────────────────────────
  'pay.title':        {pt:'Beneficiários',  en:'Payees',         es:'Beneficiarios',    fr:'Bénéficiaires'},
  'pay.new':          {pt:'Novo Beneficiário',en:'New Payee',    es:'Nuevo beneficiario',fr:'Nouveau bénéficiaire'},
  'pay.empty':        {pt:'Nenhum beneficiário',en:'No payees',  es:'Sin beneficiarios',fr:'Aucun bénéficiaire'},

  // ── Scheduled ─────────────────────────────────────────────────────────────
  'sch.title':        {pt:'Programados',    en:'Scheduled',      es:'Programados',      fr:'Programmés'},
  'sch.new':          {pt:'Novo Programado',en:'New Scheduled',  es:'Nuevo programado', fr:'Nouveau programmé'},
  'sch.empty':        {pt:'Nenhum lançamento programado',en:'No scheduled transactions',es:'Sin transacciones programadas',fr:'Aucune transaction programmée'},
  'sch.freq_daily':   {pt:'Diário',         en:'Daily',          es:'Diario',           fr:'Quotidien'},
  'sch.freq_weekly':  {pt:'Semanal',        en:'Weekly',         es:'Semanal',          fr:'Hebdomadaire'},
  'sch.freq_monthly': {pt:'Mensal',         en:'Monthly',        es:'Mensual',          fr:'Mensuel'},
  'sch.freq_yearly':  {pt:'Anual',          en:'Annual',         es:'Anual',            fr:'Annuel'},
  'sch.upcoming':     {pt:'Próximos',       en:'Upcoming',       es:'Próximos',         fr:'À venir'},
  'sch.overdue':      {pt:'Atrasados',      en:'Overdue',        es:'Atrasados',        fr:'En retard'},

  // ── Settings ──────────────────────────────────────────────────────────────
  'cfg.title':        {pt:'Configurações',  en:'Settings',       es:'Configuración',    fr:'Paramètres'},
  'cfg.profile':      {pt:'Perfil',         en:'Profile',        es:'Perfil',           fr:'Profil'},
  'cfg.family':       {pt:'Família',        en:'Family',         es:'Familia',          fr:'Famille'},
  'cfg.security':     {pt:'Segurança',      en:'Security',       es:'Seguridad',        fr:'Sécurité'},
  'cfg.language':     {pt:'Idioma',         en:'Language',       es:'Idioma',           fr:'Langue'},
  'cfg.theme':        {pt:'Tema',           en:'Theme',          es:'Tema',             fr:'Thème'},
  'cfg.notifications':{pt:'Notificações',   en:'Notifications',  es:'Notificaciones',   fr:'Notifications'},
  'cfg.modules':      {pt:'Módulos',        en:'Modules',        es:'Módulos',          fr:'Modules'},
  'cfg.backup':       {pt:'Backup',         en:'Backup',         es:'Respaldo',         fr:'Sauvegarde'},
  'cfg.ai':           {pt:'Inteligência Artificial',en:'Artificial Intelligence',es:'Inteligencia Artificial',fr:'Intelligence Artificielle'},

  // ── Months (short) ────────────────────────────────────────────────────────
  'month.jan':        {pt:'Jan',  en:'Jan',  es:'Ene',  fr:'Jan'},
  'month.feb':        {pt:'Fev',  en:'Feb',  es:'Feb',  fr:'Fév'},
  'month.mar':        {pt:'Mar',  en:'Mar',  es:'Mar',  fr:'Mar'},
  'month.apr':        {pt:'Abr',  en:'Apr',  es:'Abr',  fr:'Avr'},
  'month.may':        {pt:'Mai',  en:'May',  es:'May',  fr:'Mai'},
  'month.jun':        {pt:'Jun',  en:'Jun',  es:'Jun',  fr:'Juin'},
  'month.jul':        {pt:'Jul',  en:'Jul',  es:'Jul',  fr:'Juil'},
  'month.aug':        {pt:'Ago',  en:'Aug',  es:'Ago',  fr:'Août'},
  'month.sep':        {pt:'Set',  en:'Sep',  es:'Sep',  fr:'Sep'},
  'month.oct':        {pt:'Out',  en:'Oct',  es:'Oct',  fr:'Oct'},
  'month.nov':        {pt:'Nov',  en:'Nov',  es:'Nov',  fr:'Nov'},
  'month.dec':        {pt:'Dez',  en:'Dec',  es:'Dic',  fr:'Déc'},

  // ── Days (short) ──────────────────────────────────────────────────────────
  'day.sun':          {pt:'Dom',  en:'Sun',  es:'Dom',  fr:'Dim'},
  'day.mon':          {pt:'Seg',  en:'Mon',  es:'Lun',  fr:'Lun'},
  'day.tue':          {pt:'Ter',  en:'Tue',  es:'Mar',  fr:'Mar'},
  'day.wed':          {pt:'Qua',  en:'Wed',  es:'Mié',  fr:'Mer'},
  'day.thu':          {pt:'Qui',  en:'Thu',  es:'Jue',  fr:'Jeu'},
  'day.fri':          {pt:'Sex',  en:'Fri',  es:'Vie',  fr:'Ven'},
  'day.sat':          {pt:'Sáb',  en:'Sat',  es:'Sáb',  fr:'Sam'},

  // ── Modals & Forms ────────────────────────────────────────────────────────
  'form.account':     {pt:'Conta',             en:'Account',          es:'Cuenta',            fr:'Compte'},
  'form.category':    {pt:'Categoria',          en:'Category',         es:'Categoría',         fr:'Catégorie'},
  'form.payee':       {pt:'Beneficiário / Fonte',en:'Payee / Source', es:'Beneficiario / Fuente',fr:'Bénéficiaire / Source'},
  'form.date':        {pt:'Data',               en:'Date',             es:'Fecha',              fr:'Date'},
  'form.amount':      {pt:'Valor',              en:'Amount',           es:'Monto',              fr:'Montant'},
  'form.description': {pt:'Descrição',          en:'Description',      es:'Descripción',        fr:'Description'},
  'form.notes':       {pt:'Observações',        en:'Notes',            es:'Notas',              fr:'Notes'},
  'form.origin':      {pt:'Conta Origem',       en:'Origin Account',   es:'Cuenta origen',      fr:'Compte source'},
  'form.destination': {pt:'Conta Destino',      en:'Destination Account',es:'Cuenta destino',   fr:'Compte destination'},
  'form.password':    {pt:'Senha',              en:'Password',         es:'Contraseña',         fr:'Mot de passe'},
  'form.new_password':{pt:'Nova Senha',         en:'New Password',     es:'Nueva contraseña',   fr:'Nouveau mot de passe'},
  'form.confirm_pwd': {pt:'Confirmar Senha',    en:'Confirm Password', es:'Confirmar contraseña',fr:'Confirmer le mot de passe'},
  'form.email':       {pt:'E-mail',             en:'Email',            es:'Correo',             fr:'E-mail'},
  'form.name':        {pt:'Nome',               en:'Name',             es:'Nombre',             fr:'Nom'},

  // ── Topbar / profile ──────────────────────────────────────────────────────
  'topbar.my_profile':{pt:'Meu Perfil',         en:'My Profile',       es:'Mi perfil',          fr:'Mon profil'},
  'topbar.change_pwd':{pt:'Alterar senha',      en:'Change password',  es:'Cambiar contraseña', fr:'Changer le mot de passe'},
  'topbar.manage_fam':{pt:'Gerenciar minha família',en:'Manage my family',es:'Gestionar mi familia',fr:'Gérer ma famille'},
  'topbar.logout':    {pt:'Sair',               en:'Sign out',         es:'Salir',              fr:'Se déconnecter'},

  // ── AI Insights ───────────────────────────────────────────────────────────
  'ai.analysis':      {pt:'Análise',            en:'Analysis',         es:'Análisis',           fr:'Analyse'},
  'ai.chat':          {pt:'Chat',               en:'Chat',             es:'Chat',               fr:'Chat'},
  'ai.analyze_btn':   {pt:'Analisar',           en:'Analyze',          es:'Analizar',           fr:'Analyser'},
  'ai.all_members':   {pt:'Todos os membros',   en:'All members',      es:'Todos los miembros', fr:'Tous les membres'},
  'ai.all_accounts':  {pt:'Todas as contas',    en:'All accounts',     es:'Todas las cuentas',  fr:'Tous les comptes'},
  'ai.all_payees':    {pt:'Todos os beneficiários',en:'All payees',    es:'Todos los beneficiarios',fr:'Tous les bénéficiaires'},

  // ── Prices ────────────────────────────────────────────────────────────────
  'px.title':         {pt:'Gestão de Preços',   en:'Price Management', es:'Gestión de precios', fr:'Gestion des prix'},
  'px.search':        {pt:'Buscar no catálogo de preços',en:'Search price catalog',es:'Buscar en el catálogo',fr:'Rechercher dans le catalogue'},
  'px.new_item':      {pt:'Novo Item',           en:'New Item',         es:'Nuevo artículo',     fr:'Nouvel article'},
  'px.avg_price':     {pt:'Preço médio',         en:'Avg price',        es:'Precio promedio',    fr:'Prix moyen'},
  'px.last_price':    {pt:'Último',              en:'Latest',           es:'Último',             fr:'Dernier'},
  'px.records':       {pt:'Registros',           en:'Records',          es:'Registros',          fr:'Enregistrements'},

  // ── Investments ───────────────────────────────────────────────────────────
  'inv.title':        {pt:'Carteira de Investimentos',en:'Investment Portfolio',es:'Cartera de inversiones',fr:"Portefeuille d'investissements"},
  'inv.empty':        {pt:'Nenhum investimento',en:'No investments',    es:'Sin inversiones',    fr:'Aucun investissement'},

  // ── Import / Backup ───────────────────────────────────────────────────────
  'imp.title':        {pt:'Importar / Backup',  en:'Import / Backup',  es:'Importar / Respaldo',fr:'Importer / Sauvegarde'},
  'imp.backup_now':   {pt:'Fazer Backup',        en:'Backup Now',       es:'Hacer respaldo',     fr:'Sauvegarder'},
  'imp.restore':      {pt:'Restaurar',           en:'Restore',          es:'Restaurar',          fr:'Restaurer'},

  // ── Forecast ──────────────────────────────────────────────────────────────
  'fc.title':         {pt:'Previsão de Caixa',  en:'Cash Flow Forecast', es:'Previsión de caja',  fr:'Prévision de trésorerie'},
  'fc.loading':       {pt:'Carregando previsão…',en:'Loading forecast…', es:'Cargando previsión…',fr:'Chargement…'},
  'fc.date':          {pt:'Data',               en:'Date',               es:'Fecha',              fr:'Date'},
  'fc.description':   {pt:'Descrição',          en:'Description',        es:'Descripción',        fr:'Description'},
  'fc.amount':        {pt:'Valor',              en:'Amount',             es:'Monto',              fr:'Montant'},
  'fc.balance':       {pt:'Saldo',              en:'Balance',            es:'Saldo',              fr:'Solde'},
  'fc.period_total':  {pt:'Total do período',   en:'Period total',       es:'Total del período',  fr:'Total de la période'},
  'fc.final_balance': {pt:'Saldo final previsto',en:'Projected balance', es:'Saldo final previsto',fr:'Solde final prévu'},
  'fc.current_balance':{pt:'Saldo atual:',      en:'Current balance:',   es:'Saldo actual:',      fr:'Solde actuel :'},
  'fc.empty':         {pt:'Nenhuma transação neste período',en:'No transactions in this period',es:'Sin transacciones en este período',fr:'Aucune transaction dans cette période'},
  'fc.txs_in_period': {pt:'transação no período',en:'transaction in period',es:'transacción en el período',fr:'transaction dans la période'},
  'fc.txs_in_period_pl':{pt:'transações no período',en:'transactions in period',es:'transacciones en el período',fr:'transactions dans la période'},

  // ── Investments ───────────────────────────────────────────────────────────
  'inv.empty':        {pt:'Nenhuma conta de investimentos', en:'No investment accounts', es:'Sin cuentas de inversión', fr:"Aucun compte d'investissement"},
  'inv.asset_code':   {pt:'Código do Ativo',    en:'Asset Code',         es:'Código del activo',  fr:'Code actif'},
  'inv.current_price':{pt:'Cotação Atual',      en:'Current Price',      es:'Cotización actual',  fr:'Cours actuel'},
  'inv.avg_cost':     {pt:'Custo Médio',        en:'Average Cost',       es:'Costo promedio',     fr:'Coût moyen'},
  'inv.total_cost':   {pt:'Custo Total',        en:'Total Cost',         es:'Costo total',        fr:'Coût total'},
  'inv.evolution':    {pt:'Evolução do Investimento',en:'Investment Evolution',es:'Evolución de la inversión',fr:"Évolution de l'investissement"},
  'inv.history':      {pt:'Histórico de Movimentações',en:'Transaction History',es:'Historial de movimientos',fr:'Historique des mouvements'},
  'inv.active':       {pt:'Ativo',              en:'Active',             es:'Activo',             fr:'Actif'},

  // ── Scheduled ─────────────────────────────────────────────────────────────
  'sch.upcoming_label':{pt:'Próximos lançamentos',en:'Upcoming entries', es:'Próximos lanzamientos',fr:'Prochaines entrées'},
  'sch.past_due':     {pt:'Vencido',            en:'Past due',           es:'Vencido',            fr:'Échu'},
  'sch.next_date':    {pt:'Próxima data',       en:'Next date',          es:'Próxima fecha',      fr:'Prochaine date'},
  'sch.frequency':    {pt:'Frequência',         en:'Frequency',          es:'Frecuencia',         fr:'Fréquence'},
  'sch.register':     {pt:'Registrar',          en:'Register',           es:'Registrar',          fr:'Enregistrer'},
  'sch.skip':         {pt:'Pular',              en:'Skip',               es:'Omitir',             fr:'Ignorer'},
  'sch.freq_once':    {pt:'Uma vez',            en:'Once',               es:'Una vez',            fr:'Une fois'},
  'sch.freq_biweekly':{pt:'Quinzenal',          en:'Biweekly',           es:'Quincenal',          fr:'Bimensuel'},
  'sch.freq_bimonthly':{pt:'Bimestral',         en:'Bimonthly',          es:'Bimestral',          fr:'Bimestriel'},
  'sch.freq_quarterly':{pt:'Trimestral',        en:'Quarterly',          es:'Trimestral',         fr:'Trimestriel'},
  'sch.freq_semiannual':{pt:'Semestral',        en:'Semiannual',         es:'Semestral',          fr:'Semestriel'},
  'sch.freq_custom':  {pt:'Personalizado',      en:'Custom',             es:'Personalizado',      fr:'Personnalisé'},
  'sch.auto_register':{pt:'Registrar automaticamente', en:'Auto register', es:'Registrar automáticamente', fr:'Enregistrer automatiquement'},
  'sch.auto_confirm': {pt:'Confirmar automaticamente', en:'Auto confirm',  es:'Confirmar automáticamente', fr:'Confirmer automatiquement'},
  'sch.type_expense': {pt:'Despesa',            en:'Expense',            es:'Gasto',              fr:'Dépense'},
  'sch.type_income':  {pt:'Receita',            en:'Income',             es:'Ingreso',            fr:'Revenu'},
  'sch.type_transfer':{pt:'Transferência',      en:'Transfer',           es:'Transferencia',      fr:'Virement'},
  'sch.type_card_payment':{pt:'Pagamento de fatura',en:'Card payment',   es:'Pago de factura',    fr:'Paiement de facture'},
  'sch.status_active':{pt:'Ativo',              en:'Active',             es:'Activo',             fr:'Actif'},
  'sch.status_paused':{pt:'Pausado',            en:'Paused',             es:'Pausado',            fr:'En pause'},
  'sch.status_finished':{pt:'Finalizado',       en:'Finished',           es:'Finalizado',         fr:'Terminé'},

  // ── AI Insights ───────────────────────────────────────────────────────────
  'ai.title':              {pt:'AI Insights',        en:'AI Insights',        es:'Perspectivas IA',    fr:'Aperçus IA'},
  'ai.tab_analysis':       {pt:'Análise',            en:'Analysis',           es:'Análisis',           fr:'Analyse'},
  'ai.tab_chat':           {pt:'Chat',               en:'Chat',               es:'Chat',               fr:'Chat'},
  'ai.run_analysis':       {pt:'Gerar Análise',      en:'Run Analysis',       es:'Generar análisis',   fr:'Lancer analyse'},
  'ai.loading':            {pt:'Analisando seus dados…', en:'Analysing your data…', es:'Analizando datos…', fr:'Analyse en cours…'},
  'ai.error':              {pt:'Erro ao gerar análise', en:'Error generating analysis', es:'Error al generar análisis', fr:"Erreur lors de l'analyse"},
  'ai.no_data':            {pt:'Sem dados suficientes para análise', en:'Not enough data for analysis', es:'Datos insuficientes', fr:'Données insuffisantes'},
  'ai.credit_card_projection': {pt:'Projeção de Cartões de Crédito', en:'Credit Card Projection', es:'Proyección tarjetas de crédito', fr:'Projection cartes de crédit'},
  'ai.one_time_alert':     {pt:'Evento único',       en:'One-time event',     es:'Evento único',       fr:'Événement ponctuel'},
  'ai.recurring_income':   {pt:'Receita recorrente', en:'Recurring income',   es:'Ingreso recurrente', fr:'Revenu récurrent'},
  'ai.forecast_title':     {pt:'Prognóstico Financeiro — 6 meses', en:'Financial Forecast — 6 months', es:'Pronóstico financiero — 6 meses', fr:'Prévision financière — 6 mois'},
  'ai.sustainability_ok':  {pt:'Sustentável',        en:'Sustainable',        es:'Sostenible',         fr:'Soutenable'},
  'ai.sustainability_warning':{pt:'Atenção',         en:'Warning',            es:'Atención',           fr:'Attention'},
  'ai.sustainability_critical':{pt:'Crítico',        en:'Critical',           es:'Crítico',            fr:'Critique'},
  'ai.chat_placeholder':   {pt:'Pergunte sobre suas finanças…', en:'Ask about your finances…', es:'Pregunta sobre tus finanzas…', fr:'Posez une question sur vos finances…'},
  'ai.send':               {pt:'Enviar',             en:'Send',               es:'Enviar',             fr:'Envoyer'},

  // ── Settings / Language ───────────────────────────────────────────────────
  'settings.language':     {pt:'Idioma da interface', en:'Interface language', es:'Idioma de la interfaz', fr:"Langue de l'interface"},
  'settings.lang_pt':      {pt:'Português',          en:'Portuguese',         es:'Portugués',          fr:'Portugais'},
  'settings.lang_en':      {pt:'Inglês',             en:'English',            es:'Inglés',             fr:'Anglais'},
  'settings.lang_es':      {pt:'Espanhol',           en:'Spanish',            es:'Español',            fr:'Espagnol'},
  'settings.lang_fr':      {pt:'Francês',            en:'French',             es:'Francés',            fr:'Français'},
  'settings.appearance':   {pt:'Aparência',          en:'Appearance',         es:'Apariencia',         fr:'Apparence'},
  'settings.theme':        {pt:'Tema',               en:'Theme',              es:'Tema',               fr:'Thème'},
  'settings.theme_light':  {pt:'Claro',              en:'Light',              es:'Claro',              fr:'Clair'},
  'settings.theme_dark':   {pt:'Escuro',             en:'Dark',               es:'Oscuro',             fr:'Sombre'},
  'settings.theme_auto':   {pt:'Automático',         en:'Automatic',          es:'Automático',         fr:'Automatique'},
  'settings.currency':     {pt:'Moeda padrão',       en:'Default currency',   es:'Moneda predeterminada', fr:'Devise par défaut'},
  'settings.notifications':{pt:'Notificações',       en:'Notifications',      es:'Notificaciones',     fr:'Notifications'},
  'settings.email_notif':  {pt:'Notificações por e-mail', en:'Email notifications', es:'Notificaciones por correo', fr:'Notifications par e-mail'},
  'settings.family_modules':{pt:'Módulos da Família',en:'Family Modules',     es:'Módulos de familia', fr:'Modules de la famille'},
  'settings.ai_key':       {pt:'Chave API Gemini',   en:'Gemini API Key',     es:'Clave API Gemini',   fr:'Clé API Gemini'},
  'settings.save_success': {pt:'Configurações salvas!',en:'Settings saved!',  es:'¡Configuración guardada!',fr:'Paramètres enregistrés !'},
  'settings.profile':      {pt:'Perfil',             en:'Profile',            es:'Perfil',             fr:'Profil'},
  'settings.change_password':{pt:'Alterar senha',    en:'Change password',    es:'Cambiar contraseña', fr:'Changer le mot de passe'},
  'settings.new_password': {pt:'Nova senha',         en:'New password',       es:'Nueva contraseña',   fr:'Nouveau mot de passe'},
  'settings.confirm_password':{pt:'Confirmar nova senha', en:'Confirm new password', es:'Confirmar nueva contraseña', fr:'Confirmer le nouveau mot de passe'},


  'status.active':    {pt:'Ativo',              en:'Active',             es:'Activo',             fr:'Actif'},
  'status.inactive':  {pt:'Inativo',            en:'Inactive',           es:'Inactivo',           fr:'Inactif'},
  'status.pending':   {pt:'Pendente',           en:'Pending',            es:'Pendiente',          fr:'En attente'},
  'status.confirmed': {pt:'Confirmado',         en:'Confirmed',          es:'Confirmado',         fr:'Confirmé'},
  'status.cancelled': {pt:'Cancelado',          en:'Cancelled',          es:'Cancelado',          fr:'Annulé'},
  'status.approved':  {pt:'Aprovado',           en:'Approved',           es:'Aprobado',           fr:'Approuvé'},
  'status.waiting':   {pt:'Aguardando',         en:'Waiting',            es:'Esperando',          fr:'En attente'},
  'status.loading':   {pt:'Carregando…',       en:'Loading…',           es:'Cargando…',          fr:'Chargement…'},
  'status.saving':    {pt:'Salvando…',         en:'Saving…',            es:'Guardando…',         fr:'Enregistrement…'},
  'status.processing':{pt:'Processando…',      en:'Processing…',        es:'Procesando…',        fr:'Traitement…'},
  'status.error':     {pt:'Erro',              en:'Error',              es:'Error',              fr:'Erreur'},
  'status.success':   {pt:'Sucesso',           en:'Success',            es:'Éxito',              fr:'Succès'},

  // ── Auth / User management ────────────────────────────────────────────────
  'auth.cancel':      {pt:'Cancelar',          en:'Cancel',             es:'Cancelar',           fr:'Annuler'},
  'auth.close':       {pt:'Fechar',            en:'Close',              es:'Cerrar',             fr:'Fermer'},
  'auth.loading':     {pt:'Carregando…',      en:'Loading…',           es:'Cargando…',          fr:'Chargement…'},
  'auth.access_released':{pt:'Acesso liberado como',en:'Access granted as',es:'Acceso otorgado como',fr:'Accès accordé comme'},
  'auth.invite_origin':{pt:'Convite de origem:',en:'Invite origin:',   es:'Origen de invitación:',fr:"Origine de l'invitation :"},
  'auth.actions':     {pt:'Ações',            en:'Actions',            es:'Acciones',           fr:'Actions'},
  'auth.only_owners': {pt:'Apenas owners podem gerenciar famílias.',en:'Only owners can manage families.',es:'Solo los propietarios pueden gestionar familias.',fr:'Seuls les propriétaires peuvent gérer les familles.'},
  'auth.later':       {pt:'Depois',           en:'Later',              es:'Después',            fr:'Plus tard'},
  'auth.attention':   {pt:'Atenção:',         en:'Attention:',         es:'Atención:',          fr:'Attention :'},
  'auth.destination': {pt:'Destino (será sobrescrito)',en:'Destination (will be overwritten)',es:'Destino (será sobreescrito)',fr:'Destination (sera écrasé)'},
  'auth.settings':    {pt:'Configurações',    en:'Settings',           es:'Configuración',      fr:'Paramètres'},
  'auth.enter_ft':    {pt:'Acessar o Family FinTrack →',en:'Enter Family FinTrack →',es:'Acceder a Family FinTrack →',fr:'Accéder à Family FinTrack →'},

  // ── Backup / Import ───────────────────────────────────────────────────────
  'bkp.backup':       {pt:'Backup',           en:'Backup',             es:'Respaldo',           fr:'Sauvegarde'},
  'bkp.restore':      {pt:'Restaurar',        en:'Restore',            es:'Restaurar',          fr:'Restaurer'},
  'bkp.download':     {pt:'Baixar',           en:'Download',           es:'Descargar',          fr:'Télécharger'},
  'bkp.upload':       {pt:'Enviar',           en:'Upload',             es:'Subir',              fr:'Envoyer'},
  'bkp.created_at':   {pt:'Criado em',        en:'Created at',         es:'Creado el',          fr:'Créé le'},
  'bkp.size':         {pt:'Tamanho',          en:'Size',               es:'Tamaño',             fr:'Taille'},

  // ── Grocery ───────────────────────────────────────────────────────────────
  'groc.title':       {pt:'Lista de Mercado', en:'Grocery List',       es:'Lista de compras',   fr:'Liste de courses'},
  'groc.add_item':    {pt:'Adicionar item',   en:'Add item',           es:'Agregar artículo',   fr:'Ajouter un article'},
  'groc.empty':       {pt:'Lista vazia',      en:'Empty list',         es:'Lista vacía',        fr:'Liste vide'},
  'groc.checked':     {pt:'Marcados',         en:'Checked',            es:'Marcados',           fr:'Cochés'},
  'groc.unit':        {pt:'Unidade',          en:'Unit',               es:'Unidad',             fr:'Unité'},
  'groc.qty':         {pt:'Qtd',              en:'Qty',                es:'Cant.',              fr:'Qté'},

  // ── Reports extended ──────────────────────────────────────────────────────
  'rpt.no_data':      {pt:'Sem dados para o período',en:'No data for period',es:'Sin datos para el período',fr:'Pas de données pour la période'},
  'rpt.download_pdf': {pt:'Baixar PDF',       en:'Download PDF',       es:'Descargar PDF',      fr:'Télécharger PDF'},
  'rpt.export_csv':   {pt:'Exportar CSV',     en:'Export CSV',         es:'Exportar CSV',       fr:'Exporter CSV'},
  'rpt.col_date':     {pt:'Data',             en:'Date',               es:'Fecha',              fr:'Date'},
  'rpt.col_desc':     {pt:'Descrição',        en:'Description',        es:'Descripción',        fr:'Description'},
  'rpt.col_account':  {pt:'Conta',            en:'Account',            es:'Cuenta',             fr:'Compte'},
  'rpt.col_category': {pt:'Categoria',        en:'Category',           es:'Categoría',          fr:'Catégorie'},
  'rpt.col_payee':    {pt:'Beneficiário',     en:'Payee',              es:'Beneficiario',       fr:'Bénéficiaire'},
  'rpt.col_amount':   {pt:'Valor',            en:'Amount',             es:'Monto',              fr:'Montant'},
  'rpt.total':        {pt:'Total',            en:'Total',              es:'Total',              fr:'Total'},

  // ── Wizard ────────────────────────────────────────────────────────────────
  'wiz.next':         {pt:'Próximo →',        en:'Next →',             es:'Siguiente →',        fr:'Suivant →'},
  'wiz.prev':         {pt:'← Anterior',       en:'← Back',             es:'← Anterior',         fr:'← Précédent'},
  'wiz.finish':       {pt:'Concluir',         en:'Finish',             es:'Finalizar',          fr:'Terminer'},
  'wiz.skip':         {pt:'Pular',            en:'Skip',               es:'Omitir',             fr:'Ignorer'},
  'wiz.welcome':      {pt:'Bem-vindo!',       en:'Welcome!',           es:'¡Bienvenido!',       fr:'Bienvenue !'},
  'wiz.setup_family': {pt:'Configurar Família',en:'Set Up Family',     es:'Configurar familia', fr:'Configurer la famille'},

  // ── AI Insights extended ──────────────────────────────────────────────────
  'ai.period_from':   {pt:'De',              en:'From',               es:'Desde',              fr:'Du'},
  'ai.period_to':     {pt:'Até',             en:'To',                 es:'Hasta',              fr:'Au'},
  'ai.export':        {pt:'Exportar análise',en:'Export analysis',    es:'Exportar análisis',  fr:"Exporter l'analyse"},
  'ai.summary':       {pt:'Resumo do período',en:'Period summary',    es:'Resumen del período',fr:'Résumé de la période'},
  'ai.income_label':  {pt:'Receitas',        en:'Income',             es:'Ingresos',           fr:'Revenus'},
  'ai.expense_label': {pt:'Despesas',        en:'Expenses',           es:'Gastos',             fr:'Dépenses'},
  'ai.net_label':     {pt:'Resultado Líquido',en:'Net Result',        es:'Resultado neto',     fr:'Résultat net'},
  'ai.top_categories':{pt:'Gastos por Categoria',en:'Expenses by Category',es:'Gastos por categoría',fr:'Dépenses par catégorie'},
  'ai.top_payees':    {pt:'Top Beneficiários',en:'Top Payees',        es:'Principales beneficiarios',fr:'Principaux bénéficiaires'},
  'ai.by_member':     {pt:'Gastos por Membro',en:'Expenses by Member',es:'Gastos por miembro', fr:'Dépenses par membre'},
  'ai.monthly_trend': {pt:'Tendência Mensal', en:'Monthly Trend',     es:'Tendencia mensual',  fr:'Tendance mensuelle'},
  'ai.recommendations':{pt:'Recomendações',  en:'Recommendations',    es:'Recomendaciones',    fr:'Recommandations'},
  'ai.savings':       {pt:'Oportunidades de Economia',en:'Savings Opportunities',es:'Oportunidades de ahorro',fr:"Opportunités d'économies"},
  'ai.anomalies':     {pt:'Anomalias Detectadas',en:'Detected Anomalies',es:'Anomalías detectadas',fr:'Anomalies détectées'},
  'ai.alerts':        {pt:'Alertas de Fluxo de Caixa',en:'Cash Flow Alerts',es:'Alertas de flujo de caja',fr:'Alertes de trésorerie'},
  'ai.chat_placeholder':{pt:'Pergunte sobre suas finanças…',en:'Ask about your finances…',es:'Pregunta sobre tus finanzas…',fr:'Posez une question sur vos finances…'},
  'ai.chat_send':     {pt:'Enviar',          en:'Send',               es:'Enviar',             fr:'Envoyer'},
  'ai.chat_clear':    {pt:'Limpar chat',     en:'Clear chat',         es:'Limpiar chat',       fr:'Effacer le chat'},
  'ai.empty':         {pt:'Configure a chave Gemini para usar AI Insights',en:'Configure Gemini key to use AI Insights',es:'Configure la clave Gemini para usar AI Insights',fr:'Configurez la clé Gemini pour utiliser AI Insights'},

  // ── Direct text translations (reverse-map engine) ─────────────────────────
  // Keys match the PT text directly — used by _i18nWalkTextNodes()
  // Common UI
  'Cancelar':           {pt:'Cancelar',          en:'Cancel',            es:'Cancelar',           fr:'Annuler'},
  'Salvar':             {pt:'Salvar',             en:'Save',              es:'Guardar',            fr:'Enregistrer'},
  'Fechar':             {pt:'Fechar',             en:'Close',             es:'Cerrar',             fr:'Fermer'},
  'Adicionar':          {pt:'Adicionar',          en:'Add',               es:'Agregar',            fr:'Ajouter'},
  'Editar':             {pt:'Editar',             en:'Edit',              es:'Editar',             fr:'Modifier'},
  'Excluir':            {pt:'Excluir',            en:'Delete',            es:'Eliminar',           fr:'Supprimer'},
  'Confirmar':          {pt:'Confirmar',          en:'Confirm',           es:'Confirmar',          fr:'Confirmer'},
  'Buscar':             {pt:'Buscar',             en:'Search',            es:'Buscar',             fr:'Rechercher'},
  'Voltar':             {pt:'Voltar',             en:'Back',              es:'Volver',             fr:'Retour'},
  'Novo':               {pt:'Novo',               en:'New',               es:'Nuevo',              fr:'Nouveau'},
  'Nova':               {pt:'Nova',               en:'New',               es:'Nueva',              fr:'Nouvelle'},
  'Exportar':           {pt:'Exportar',           en:'Export',            es:'Exportar',           fr:'Exporter'},
  'Hoje':               {pt:'Hoje',               en:'Today',             es:'Hoy',                fr:"Aujourd'hui"},
  'Total':              {pt:'Total',              en:'Total',             es:'Total',              fr:'Total'},
  'Todos':              {pt:'Todos',              en:'All',               es:'Todos',              fr:'Tous'},
  'Todas':              {pt:'Todas',              en:'All',               es:'Todas',              fr:'Toutes'},
  'Saldo':              {pt:'Saldo',              en:'Balance',           es:'Saldo',              fr:'Solde'},
  'Valor':              {pt:'Valor',              en:'Amount',            es:'Monto',              fr:'Montant'},
  'Data':               {pt:'Data',               en:'Date',              es:'Fecha',              fr:'Date'},
  'Nome':               {pt:'Nome',               en:'Name',              es:'Nombre',             fr:'Nom'},
  'Tipo':               {pt:'Tipo',               en:'Type',              es:'Tipo',               fr:'Type'},
  'Moeda':              {pt:'Moeda',              en:'Currency',          es:'Moneda',             fr:'Devise'},
  'Categoria':          {pt:'Categoria',          en:'Category',          es:'Categoría',          fr:'Catégorie'},
  'Conta':              {pt:'Conta',              en:'Account',           es:'Cuenta',             fr:'Compte'},
  'Senha':              {pt:'Senha',              en:'Password',          es:'Contraseña',         fr:'Mot de passe'},
  'Idioma':             {pt:'Idioma',             en:'Language',          es:'Idioma',             fr:'Langue'},
  'Família':            {pt:'Família',            en:'Family',            es:'Familia',            fr:'Famille'},
  'Perfil':             {pt:'Perfil',             en:'Profile',           es:'Perfil',             fr:'Profil'},
  'Segurança':          {pt:'Segurança',          en:'Security',          es:'Seguridad',          fr:'Sécurité'},
  'Ativo':              {pt:'Ativo',              en:'Active',            es:'Activo',             fr:'Actif'},
  'Ativos':             {pt:'Ativos',             en:'Active',            es:'Activos',            fr:'Actifs'},
  'Sim':                {pt:'Sim',                en:'Yes',               es:'Sí',                 fr:'Oui'},
  'Não':                {pt:'Não',                en:'No',                es:'No',                 fr:'Non'},
  'Enviar':             {pt:'Enviar',             en:'Send',              es:'Enviar',             fr:'Envoyer'},
  'Copiar':             {pt:'Copiar',             en:'Copy',              es:'Copiar',             fr:'Copier'},
  'Gerenciar':          {pt:'Gerenciar',          en:'Manage',            es:'Gestionar',          fr:'Gérer'},
  'Detalhes':           {pt:'Detalhes',           en:'Details',           es:'Detalles',           fr:'Détails'},
  'Histórico':          {pt:'Histórico',          en:'History',           es:'Historial',          fr:'Historique'},
  'Ações':              {pt:'Ações',              en:'Actions',           es:'Acciones',           fr:'Actions'},
  'Observações':        {pt:'Observações',        en:'Notes',             es:'Notas',              fr:'Notes'},
  'Descrição':          {pt:'Descrição',          en:'Description',       es:'Descripción',        fr:'Description'},
  'Sair':               {pt:'Sair',               en:'Sign out',          es:'Salir',              fr:'Se déconnecter'},
  'Ver tudo →':         {pt:'Ver tudo →',         en:'View all →',        es:'Ver todo →',         fr:'Voir tout →'},
  // Transactions
  'Lançamentos':        {pt:'Lançamentos',        en:'Transactions',      es:'Transacciones',      fr:'Transactions'},
  'Receita':            {pt:'Receita',            en:'Income',            es:'Ingreso',            fr:'Revenu'},
  'Despesa':            {pt:'Despesa',            en:'Expense',           es:'Gasto',              fr:'Dépense'},
  'Transferência':      {pt:'Transferência',      en:'Transfer',          es:'Transferencia',      fr:'Virement'},
  'Receitas':           {pt:'Receitas',           en:'Income',            es:'Ingresos',           fr:'Revenus'},
  'Despesas':           {pt:'Despesas',           en:'Expenses',          es:'Gastos',             fr:'Dépenses'},
  'Todos os meses':     {pt:'Todos os meses',     en:'All months',        es:'Todos los meses',    fr:'Tous les mois'},
  'Todas as contas':    {pt:'Todas as contas',    en:'All accounts',      es:'Todas las cuentas',  fr:'Tous les comptes'},
  'Confirmadas':        {pt:'Confirmadas',        en:'Confirmed',         es:'Confirmadas',        fr:'Confirmées'},
  'Pendentes':          {pt:'Pendentes',          en:'Pending',           es:'Pendientes',         fr:'En attente'},
  'Conta Origem':       {pt:'Conta Origem',       en:'Source Account',    es:'Cuenta origen',      fr:'Compte source'},
  'Conta Destino':      {pt:'Conta Destino',      en:'Destination',       es:'Cuenta destino',     fr:'Compte destination'},
  'Nova Transação':     {pt:'Nova Transação',     en:'New Transaction',   es:'Nueva transacción',  fr:'Nouvelle transaction'},
  // Accounts
  'Nova Conta':         {pt:'Nova Conta',         en:'New Account',       es:'Nueva cuenta',       fr:'Nouveau compte'},
  'Sem grupo':          {pt:'Sem grupo',           en:'No group',          es:'Sin grupo',          fr:'Sans groupe'},
  'Total:':             {pt:'Total:',              en:'Total:',            es:'Total:',             fr:'Total:'},
  'Saldo inicial':      {pt:'Saldo inicial',       en:'Initial balance',   es:'Saldo inicial',      fr:'Solde initial'},
  'Corrente':           {pt:'Corrente',            en:'Checking',          es:'Corriente',          fr:'Courant'},
  'Poupança':           {pt:'Poupança',            en:'Savings',           es:'Ahorros',            fr:'Épargne'},
  'Cartão':             {pt:'Cartão',              en:'Card',              es:'Tarjeta',            fr:'Carte'},
  'Dinheiro':           {pt:'Dinheiro',            en:'Cash',              es:'Efectivo',           fr:'Espèces'},
  // Categories
  'Nova Categoria':     {pt:'Nova Categoria',      en:'New Category',      es:'Nueva categoría',    fr:'Nouvelle catégorie'},
  'Categoria Pai':      {pt:'Categoria Pai',       en:'Parent Category',   es:'Categoría padre',    fr:'Catégorie parente'},
  'Favoritar':          {pt:'Favoritar',           en:'Favorite',          es:'Favorito',           fr:'Favori'},
  'Editar Categoria':   {pt:'Editar Categoria',    en:'Edit Category',     es:'Editar categoría',   fr:'Modifier catégorie'},
  // Payees
  'Beneficiário':       {pt:'Beneficiário',        en:'Payee',             es:'Beneficiario',       fr:'Bénéficiaire'},
  'Beneficiários':      {pt:'Beneficiários',       en:'Payees',            es:'Beneficiarios',      fr:'Bénéficiaires'},
  'Ambos':              {pt:'Ambos',               en:'Both',              es:'Ambos',              fr:'Les deux'},
  'Pendente':           {pt:'Pendente',            en:'Pending',           es:'Pendiente',          fr:'En attente'},
  // Scheduled
  'Atrasado':           {pt:'Atrasado',            en:'Overdue',           es:'Atrasado',           fr:'En retard'},
  'Concluído':          {pt:'Concluído',           en:'Completed',         es:'Completado',         fr:'Terminé'},
  'Diário':             {pt:'Diário',              en:'Daily',             es:'Diario',             fr:'Quotidien'},
  'Semanal':            {pt:'Semanal',             en:'Weekly',            es:'Semanal',            fr:'Hebdomadaire'},
  'Mensal':             {pt:'Mensal',              en:'Monthly',           es:'Mensual',            fr:'Mensuel'},
  'Bimestral':          {pt:'Bimestral',           en:'Bimonthly',         es:'Bimestral',          fr:'Bimestriel'},
  'Trimestral':         {pt:'Trimestral',          en:'Quarterly',         es:'Trimestral',         fr:'Trimestriel'},
  'Semestral':          {pt:'Semestral',           en:'Semiannual',        es:'Semestral',          fr:'Semestriel'},
  'Anual':              {pt:'Anual',               en:'Annual',            es:'Anual',              fr:'Annuel'},
  // Reports
  'Ticket médio':       {pt:'Ticket médio',        en:'Avg ticket',        es:'Ticket promedio',    fr:'Ticket moyen'},
  'Por Categoria':      {pt:'Por Categoria',       en:'By Category',       es:'Por categoría',      fr:'Par catégorie'},
  'Por Mês':            {pt:'Por Mês',             en:'By Month',          es:'Por mes',            fr:'Par mois'},
  'Previsão':           {pt:'Previsão',            en:'Forecast',          es:'Previsión',          fr:'Prévision'},
  'Mês atual':          {pt:'Mês atual',           en:'Current month',     es:'Mes actual',         fr:'Mois en cours'},
  'Trimestre':          {pt:'Trimestre',           en:'Quarter',           es:'Trimestre',          fr:'Trimestre'},
  'Ano atual':          {pt:'Ano atual',           en:'Current year',      es:'Año actual',         fr:'Année en cours'},
  'Personalizado':      {pt:'Personalizado',       en:'Custom',            es:'Personalizado',      fr:'Personnalisé'},
  // Budgets
  'Utilizado':          {pt:'Utilizado',           en:'Used',              es:'Utilizado',          fr:'Utilisé'},
  'Restante':           {pt:'Restante',            en:'Remaining',         es:'Restante',           fr:'Restant'},
  'Excedido':           {pt:'Excedido',            en:'Over budget',       es:'Excedido',           fr:'Dépassé'},
  // Settings
  'Configurações':      {pt:'Configurações',       en:'Settings',          es:'Configuración',      fr:'Paramètres'},
  'Ativar':             {pt:'Ativar',              en:'Enable',            es:'Activar',            fr:'Activer'},
  'Desativar':          {pt:'Desativar',           en:'Disable',           es:'Desactivar',         fr:'Désactiver'},
  'Módulos':            {pt:'Módulos',             en:'Modules',           es:'Módulos',            fr:'Modules'},
  // Investments
  'Compra':             {pt:'Compra',              en:'Buy',               es:'Compra',             fr:'Achat'},
  'Venda':              {pt:'Venda',               en:'Sell',              es:'Venta',              fr:'Vente'},
  'Custo':              {pt:'Custo',               en:'Cost',              es:'Costo',              fr:'Coût'},
  'Cotação':            {pt:'Cotação',             en:'Quote',             es:'Cotización',         fr:'Cours'},
  // Prices
  'Preço médio':        {pt:'Preço médio',         en:'Avg price',         es:'Precio promedio',    fr:'Prix moyen'},
  'Último':             {pt:'Último',              en:'Latest',            es:'Último',             fr:'Dernier'},
  'Registros':          {pt:'Registros',           en:'Records',           es:'Registros',          fr:'Enregistrements'},
  // AI
  'Análise':            {pt:'Análise',             en:'Analysis',          es:'Análisis',           fr:'Analyse'},
  'Analisar':           {pt:'Analisar',            en:'Analyze',           es:'Analizar',           fr:'Analyser'},
  'Todos os membros':   {pt:'Todos os membros',    en:'All members',       es:'Todos los miembros', fr:'Tous les membres'},
  // Months full
  'Janeiro':            {pt:'Janeiro',             en:'January',           es:'Enero',              fr:'Janvier'},
  'Fevereiro':          {pt:'Fevereiro',           en:'February',          es:'Febrero',            fr:'Février'},
  'Março':              {pt:'Março',               en:'March',             es:'Marzo',              fr:'Mars'},
  'Abril':              {pt:'Abril',               en:'April',             es:'Abril',              fr:'Avril'},
  'Maio':               {pt:'Maio',                en:'May',               es:'Mayo',               fr:'Mai'},
  'Junho':              {pt:'Junho',               en:'June',              es:'Junio',              fr:'Juin'},
  'Julho':              {pt:'Julho',               en:'July',              es:'Julio',              fr:'Juillet'},
  'Agosto':             {pt:'Agosto',              en:'August',            es:'Agosto',             fr:'Août'},
  'Setembro':           {pt:'Setembro',            en:'September',         es:'Septiembre',         fr:'Septembre'},
  'Outubro':            {pt:'Outubro',             en:'October',           es:'Octubre',            fr:'Octobre'},
  'Novembro':           {pt:'Novembro',            en:'November',          es:'Noviembre',          fr:'Novembre'},
  'Dezembro':           {pt:'Dezembro',            en:'December',          es:'Diciembre',          fr:'Décembre'},
  // Forecast
  'Saldo final prev.':  {pt:'Saldo final prev.',   en:'Projected balance',  es:'Saldo final prev.',  fr:'Solde final prévu'},
  'Total do período':   {pt:'Total do período',    en:'Period total',       es:'Total del período',  fr:'Total de la période'},
  'Saldo atual:':       {pt:'Saldo atual:',        en:'Current balance:',   es:'Saldo actual:',      fr:'Solde actuel:'},

  // ── Complete UI translations added ─────────────────────────────────────────
  '% do Grupo': {pt:'% do Grupo', en:'% of group', es:'% del grupo', fr:'% du groupe'},
  'A cada': {pt:'A cada', en:'Every', es:'Cada', fr:'Chaque'},
  'Abra uma lista primeiro.': {pt:'Abra uma lista primeiro.', en:'Open a list first.', es:'Abra una lista primero.', fr:"Ouvrez d\'abord une liste."},
  'Abrir': {pt:'Abrir', en:'Open', es:'Abrir', fr:'Ouvrir'},
  'Abrir lista': {pt:'Abrir lista', en:'Open list', es:'Abrir lista', fr:'Ouvrir la liste'},
  'Adicionar à lista de compras': {pt:'Adicionar à lista de compras', en:'Add to shopping list', es:'Agregar a la lista de compras', fr:'Ajouter à la liste de courses'},
  'Adicione os membros para personalizar o app.': {pt:'Adicione os membros para personalizar o app.', en:'Add members to personalize the app.', es:'Añada miembros para personalizar la app.', fr:"Ajoutez des membres pour personnaliser l\'app."},
  'Admin (acesso total)': {pt:'Admin (acesso total)', en:'Admin (full access)', es:'Admin (acceso total)', fr:'Admin (accès total)'},
  'Administrador': {pt:'Administrador', en:'Administrator', es:'Administrador', fr:'Administrateur'},
  'Admins e owners sempre veem todas as configurações.': {pt:'Admins e owners sempre veem todas as configurações.', en:'Admins and owners always see all settings.', es:'Los admins y propietarios siempre ven toda la configuración.', fr:'Les admins et propriétaires voient toujours tous les paramètres.'},
  'Adulto': {pt:'Adulto', en:'Adult', es:'Adulto', fr:'Adulte'},
  'Adultos': {pt:'Adultos', en:'Adults', es:'Adultos', fr:'Adultes'},
  'Adultos podem ter acesso ao app. Você pode convidar agora ou depois.': {pt:'Adultos podem ter acesso ao app. Você pode convidar agora ou depois.', en:'Adults can have app access. You can invite now or later.', es:'Los adultos pueden tener acceso a la app. Puede invitar ahora o después.', fr:"Les adultes peuvent avoir accès à l\'app. Vous pouvez inviter maintenant ou plus tard."},
  'Agora': {pt:'Agora', en:'Now', es:'Ahora', fr:'Maintenant'},
  'Agrupar por categoria': {pt:'Agrupar por categoria', en:'Group by category', es:'Agrupar por categoría', fr:'Grouper par catégorie'},
  'Agrupar por estabelecimento': {pt:'Agrupar por estabelecimento', en:'Group by store', es:'Agrupar por establecimiento', fr:'Grouper par établissement'},
  'Aguardando registro': {pt:'Aguardando registro', en:'Awaiting registration', es:'Esperando registro', fr:"En attente d\'enregistrement"},
  'Aguarde…': {pt:'Aguarde…', en:'Please wait…', es:'Espere…', fr:'Veuillez patienter…'},
  'Ajuste de saldo / Consolidação': {pt:'Ajuste de saldo / Consolidação', en:'Balance adjustment / Consolidation', es:'Ajuste de saldo / Consolidación', fr:'Ajustement de solde / Consolidation'},
  'Alterar': {pt:'Alterar', en:'Change', es:'Cambiar', fr:'Modifier'},
  'Alterar Masterpin': {pt:'Alterar Masterpin', en:'Change Masterpin', es:'Cambiar Masterpin', fr:'Changer le Masterpin'},
  'Alternar sinal': {pt:'Alternar sinal', en:'Toggle sign', es:'Alternar signo', fr:'Inverser le signe'},
  'Amanhã': {pt:'Amanhã', en:'Tomorrow', es:'Mañana', fr:'Demain'},
  'Analisar & Prévia →': {pt:'Analisar & Prévia →', en:'Analyze & Preview →', es:'Analizar y vista previa →', fr:'Analyser et aperçu →'},
  'Anexo': {pt:'Anexo', en:'Attachment', es:'Adjunto', fr:'Pièce jointe'},
  'Anexo (PDF ou imagem)': {pt:'Anexo (PDF ou imagem)', en:'Attachment (PDF or image)', es:'Adjunto (PDF o imagen)', fr:'Pièce jointe (PDF ou image)'},
  'Anos': {pt:'Anos', en:'Years', es:'Años', fr:'Ans'},
  'Análise Geral': {pt:'Análise Geral', en:'General Analysis', es:'Análisis general', fr:'Analyse générale'},
  'Apenas admin pode alterar o logotipo': {pt:'Apenas admin pode alterar o logotipo', en:'Only admin can change the logo', es:'Solo el admin puede cambiar el logo', fr:"Seul l\'admin peut changer le logo"},
  'Aplicar': {pt:'Aplicar', en:'Apply', es:'Aplicar', fr:'Appliquer'},
  'Arrastar': {pt:'Arrastar', en:'Drag', es:'Arrastrar', fr:'Glisser'},
  'Arrastar para reordenar': {pt:'Arrastar para reordenar', en:'Drag to reorder', es:'Arrastrar para reordenar', fr:'Faire glisser pour réorganiser'},
  'Ativar módulo': {pt:'Ativar módulo', en:'Enable module', es:'Activar módulo', fr:'Activer le module'},
  'Atualizar': {pt:'Atualizar', en:'Update', es:'Actualizar', fr:'Mettre à jour'},
  'Auditoria': {pt:'Auditoria', en:'Audit', es:'Auditoría', fr:'Audit'},
  'Auditoria (admin)': {pt:'Auditoria (admin)', en:'Audit (admin)', es:'Auditoría (admin)', fr:'Audit (admin)'},
  'Auditoria de Auto-registros': {pt:'Auditoria de Auto-registros', en:'Auto-registration audit', es:'Auditoría de registros automáticos', fr:"Audit d\'auto-enregistrement"},
  'Automação de Programados': {pt:'Automação de Programados', en:'Scheduled automation', es:'Automatización de programados', fr:'Automatisation des programmés'},
  'Automação de transações programadas': {pt:'Automação de transações programadas', en:'Scheduled transaction automation', es:'Automatización de transacciones programadas', fr:'Automatisation des transactions programmées'},
  'Automático': {pt:'Automático', en:'Automatic', es:'Automático', fr:'Automatique'},
  'Avançado': {pt:'Avançado', en:'Advanced', es:'Avanzado', fr:'Avancé'},
  'Avisar com antecedência': {pt:'Avisar com antecedência', en:'Notify in advance', es:'Avisar con anticipación', fr:"Avertir à l\'avance"},
  'Ação BR': {pt:'Ação BR', en:'Brazilian stock', es:'Acción BR', fr:'Action brésilienne'},
  'Ação US': {pt:'Ação US', en:'US stock', es:'Acción US', fr:'Action américaine'},
  'Backup automático de dados': {pt:'Backup automático de dados', en:'Automatic data backup', es:'Copia de seguridad automática', fr:'Sauvegarde automatique des données'},
  'Backup do banco de dados': {pt:'Backup do banco de dados', en:'Database backup', es:'Copia de seguridad de base de datos', fr:'Sauvegarde de la base de données'},
  'Barras': {pt:'Barras', en:'Bars', es:'Barras', fr:'Barres'},
  'Beneficiário excluído': {pt:'Beneficiário excluído', en:'Payee deleted', es:'Beneficiario eliminado', fr:'Bénéficiaire supprimé'},
  'Beneficiário vinculado': {pt:'Beneficiário vinculado', en:'Linked payee', es:'Beneficiario vinculado', fr:'Bénéficiaire lié'},
  'Beneficiários & Fontes Pagadoras': {pt:'Beneficiários & Fontes Pagadoras', en:'Payees & Payers', es:'Beneficiarios y pagadores', fr:'Bénéficiaires et payeurs'},
  'Beneficiários únicos encontrados.': {pt:'Beneficiários únicos encontrados.', en:'Unique payees found.', es:'Beneficiarios únicos encontrados.', fr:'Bénéficiaires uniques trouvés.'},
  'Básico': {pt:'Básico', en:'Basic', es:'Básico', fr:'Basique'},
  'CDB, LCI, Tesouro': {pt:'CDB, LCI, Tesouro', en:'CDB, LCI, Treasury', es:'CDB, LCI, Tesoro', fr:'CDB, LCI, Trésor'},
  'CEP': {pt:'CEP', en:'ZIP', es:'Código postal', fr:'Code postal'},
  'CNPJ': {pt:'CNPJ', en:'Tax ID', es:'NIF', fr:'SIRET'},
  'CNPJ / CPF': {pt:'CNPJ / CPF', en:'Tax ID / CPF', es:'NIF / CPF', fr:'SIRET / CPF'},
  'CNPJ/CPF': {pt:'CNPJ/CPF', en:'Tax ID/CPF', es:'NIF/CPF', fr:'SIRET/CPF'},
  'CPF': {pt:'CPF', en:'CPF', es:'CPF', fr:'CPF'},
  'Campo obrigatório': {pt:'Campo obrigatório', en:'Required field', es:'Campo obligatorio', fr:'Champ obligatoire'},
  'Carregar': {pt:'Carregar', en:'Load', es:'Cargar', fr:'Charger'},
  'Carregar ao entrar': {pt:'Carregar ao entrar', en:'Load on login', es:'Cargar al entrar', fr:'Charger à la connexion'},
  'Carteira': {pt:'Carteira', en:'Wallet', es:'Cartera', fr:'Portefeuille'},
  'Cartão de Crédito': {pt:'Cartão de Crédito', en:'Credit card', es:'Tarjeta de crédito', fr:'Carte de crédit'},
  'Cashflow 6 meses + gráfico de despesas': {pt:'Cashflow 6 meses + gráfico de despesas', en:'6-month cashflow + expense chart', es:'Flujo de caja 6 meses + gráfico de gastos', fr:'Trésorerie 6 mois + graphique des dépenses'},
  'Categoria Padrão': {pt:'Categoria Padrão', en:'Default Category', es:'Categoría predeterminada', fr:'Catégorie par défaut'},
  'Categoria excluída': {pt:'Categoria excluída', en:'Category deleted', es:'Categoría eliminada', fr:'Catégorie supprimée'},
  'Categoria padrão': {pt:'Categoria padrão', en:'Default category', es:'Categoría predeterminada', fr:'Catégorie par défaut'},
  'Categoria salva!': {pt:'Categoria salva!', en:'Category saved!', es:'¡Categoría guardada!', fr:'Catégorie enregistrée !'},
  'Catálogo de preços': {pt:'Catálogo de preços', en:'Price catalog', es:'Catálogo de precios', fr:'Catalogue de prix'},
  'Chave': {pt:'Chave', en:'Key', es:'Clave', fr:'Clé'},
  'Chave API Google Gemini': {pt:'Chave API Google Gemini', en:'Google Gemini API Key', es:'Clave API de Google Gemini', fr:'Clé API Google Gemini'},
  'Cidade': {pt:'Cidade', en:'City', es:'Ciudad', fr:'Ville'},
  'Colar': {pt:'Colar', en:'Paste', es:'Pegar', fr:'Coller'},
  'Comprado': {pt:'Comprado', en:'Purchased', es:'Comprado', fr:'Acheté'},
  'Conciliadas': {pt:'Conciliadas', en:'Reconciled', es:'Conciliadas', fr:'Rapprochées'},
  'Conectar': {pt:'Conectar', en:'Connect', es:'Conectar', fr:'Connecter'},
  'Config': {pt:'Config', en:'Config', es:'Config', fr:'Config'},
  'Configurações de IA': {pt:'Configurações de IA', en:'AI Settings', es:'Configuración de IA', fr:"Paramètres d\'IA"},
  'Confirmada': {pt:'Confirmada', en:'Confirmed', es:'Confirmada', fr:'Confirmée'},
  'Confirmar Nova Senha': {pt:'Confirmar Nova Senha', en:'Confirm New Password', es:'Confirmar nueva contraseña', fr:'Confirmer le nouveau mot de passe'},
  'Confirmar senha': {pt:'Confirmar senha', en:'Confirm password', es:'Confirmar contraseña', fr:'Confirmer le mot de passe'},
  'Conta & Segurança': {pt:'Conta & Segurança', en:'Account & Security', es:'Cuenta y seguridad', fr:'Compte et sécurité'},
  'Conta Corrente': {pt:'Conta Corrente', en:'Checking account', es:'Cuenta corriente', fr:'Compte courant'},
  'Conta Destino *': {pt:'Conta Destino *', en:'Destination account *', es:'Cuenta destino *', fr:'Compte destination *'},
  'Conta Investimento': {pt:'Conta Investimento', en:'Investment account', es:'Cuenta de inversión', fr:"Compte d\'investissement"},
  'Conta Origem *': {pt:'Conta Origem *', en:'Source account *', es:'Cuenta origen *', fr:'Compte source *'},
  'Conta Poupança': {pt:'Conta Poupança', en:'Savings account', es:'Cuenta de ahorros', fr:'Compte épargne'},
  'Conta de origem': {pt:'Conta de origem', en:'Source account', es:'Cuenta de origen', fr:'Compte source'},
  'Conta destino': {pt:'Conta destino', en:'Destination account', es:'Cuenta destino', fr:'Compte destination'},
  'Conta destino padrão:': {pt:'Conta destino padrão:', en:'Default destination account:', es:'Cuenta destino predeterminada:', fr:'Compte destination par défaut:'},
  'Conta padrão (se não informada na linha):': {pt:'Conta padrão (se não informada na linha):', en:'Default account (if not set in row):', es:'Cuenta predeterminada (si no está en la fila):', fr:'Compte par défaut (si non défini dans la ligne):'},
  'Conta, categoria, beneficiário': {pt:'Conta, categoria, beneficiário', en:'Account, category, payee', es:'Cuenta, categoría, beneficiario', fr:'Compte, catégorie, bénéficiaire'},
  'Continuar': {pt:'Continuar', en:'Continue', es:'Continuar', fr:'Continuer'},
  'Continuar →': {pt:'Continuar →', en:'Continue →', es:'Continuar →', fr:'Continuer →'},
  'Convidar': {pt:'Convidar', en:'Invite', es:'Invitar', fr:'Inviter'},
  'Convite': {pt:'Convite', en:'Invitation', es:'Invitación', fr:'Invitation'},
  'Cor': {pt:'Cor', en:'Color', es:'Color', fr:'Couleur'},
  'Corretora': {pt:'Corretora', en:'Broker', es:'Corredor', fr:'Courtier'},
  'Cotação atualizada': {pt:'Cotação atualizada', en:'Quote updated', es:'Cotización actualizada', fr:'Cours mis à jour'},
  'Criança': {pt:'Criança', en:'Child', es:'Niño', fr:'Enfant'},
  'Crianças': {pt:'Crianças', en:'Children', es:'Niños', fr:'Enfants'},
  'Criar': {pt:'Criar', en:'Create', es:'Crear', fr:'Créer'},
  'Criar Lista': {pt:'Criar Lista', en:'Create List', es:'Crear lista', fr:'Créer une liste'},
  'Criar Usuário': {pt:'Criar Usuário', en:'Create User', es:'Crear usuario', fr:'Créer un utilisateur'},
  'Crie uma conta do tipo Investimentos primeiro': {pt:'Crie uma conta do tipo Investimentos primeiro', en:'Create an investment account first', es:'Cree primero una cuenta de inversiones', fr:"Créez d\'abord un compte investissements"},
  'Criptomoeda': {pt:'Criptomoeda', en:'Cryptocurrency', es:'Criptomoneda', fr:'Cryptomonnaie'},
  'Câmbio': {pt:'Câmbio', en:'Exchange rate', es:'Tipo de cambio', fr:'Taux de change'},
  'Código': {pt:'Código', en:'Code', es:'Código', fr:'Code'},
  'Data de fim': {pt:'Data de fim', en:'End date', es:'Fecha de fin', fr:'Date de fin'},
  'Data de início': {pt:'Data de início', en:'Start date', es:'Fecha de inicio', fr:'Date de début'},
  'Data de início *': {pt:'Data de início *', en:'Start date *', es:'Fecha de inicio *', fr:'Date de début *'},
  'Dentro do orçamento': {pt:'Dentro do orçamento', en:'Within budget', es:'Dentro del presupuesto', fr:'Dans le budget'},
  'Desconectar': {pt:'Desconectar', en:'Disconnect', es:'Desconectar', fr:'Déconnecter'},
  'Desmarcar tudo': {pt:'Desmarcar tudo', en:'Unmark all', es:'Desmarcar todo', fr:'Tout décocher'},
  'Despesas por Categoria': {pt:'Despesas por Categoria', en:'Expenses by Category', es:'Gastos por categoría', fr:'Dépenses par catégorie'},
  'Despesas por categoria': {pt:'Despesas por categoria', en:'Expenses by category', es:'Gastos por categoría', fr:'Dépenses par catégorie'},
  'Detalhamento por Categoria': {pt:'Detalhamento por Categoria', en:'Category Breakdown', es:'Desglose por categoría', fr:'Détail par catégorie'},
  'Detalhes da transação': {pt:'Detalhes da transação', en:'Transaction details', es:'Detalles de transacción', fr:'Détails de la transaction'},
  'Dias': {pt:'Dias', en:'Days', es:'Días', fr:'Jours'},
  'Distribuição por Categoria': {pt:'Distribuição por Categoria', en:'Distribution by Category', es:'Distribución por categoría', fr:'Distribution par catégorie'},
  'Distribuição por Conta': {pt:'Distribuição por Conta', en:'Distribution by Account', es:'Distribución por cuenta', fr:'Distribution par compte'},
  'Editar Beneficiário': {pt:'Editar Beneficiário', en:'Edit Payee', es:'Editar beneficiario', fr:'Modifier le bénéficiaire'},
  'Editar Conta': {pt:'Editar Conta', en:'Edit Account', es:'Editar cuenta', fr:'Modifier le compte'},
  'Editar Grupo': {pt:'Editar Grupo', en:'Edit Group', es:'Editar grupo', fr:'Modifier le groupe'},
  'Editar Orçamento': {pt:'Editar Orçamento', en:'Edit Budget', es:'Editar presupuesto', fr:'Modifier le budget'},
  'Editar Programado': {pt:'Editar Programado', en:'Edit Scheduled', es:'Editar programado', fr:'Modifier le programmé'},
  'Editar Transação': {pt:'Editar Transação', en:'Edit Transaction', es:'Editar transacción', fr:'Modifier la transaction'},
  'Edite a categoria para mudar seu pai': {pt:'Edite a categoria para mudar seu pai', en:'Edit the category to change its parent', es:'Edite la categoría para cambiar su padre', fr:'Modifiez la catégorie pour changer son parent'},
  'Endereço': {pt:'Endereço', en:'Address', es:'Dirección', fr:'Adresse'},
  'Erro ao carregar': {pt:'Erro ao carregar', en:'Error loading', es:'Error al cargar', fr:'Erreur lors du chargement'},
  'Erro ao excluir': {pt:'Erro ao excluir', en:'Error deleting', es:'Error al eliminar', fr:'Erreur lors de la suppression'},
  'Erro ao salvar': {pt:'Erro ao salvar', en:'Error saving', es:'Error al guardar', fr:"Erreur lors de l\'enregistrement"},
  'Estabelecimento': {pt:'Estabelecimento', en:'Store', es:'Establecimiento', fr:'Établissement'},
  'Estabelecimentos': {pt:'Estabelecimentos', en:'Stores', es:'Establecimientos', fr:'Établissements'},
  'Estado': {pt:'Estado', en:'State', es:'Estado', fr:'État'},
  'Etiqueta': {pt:'Etiqueta', en:'Tag', es:'Etiqueta', fr:'Étiquette'},
  'Etiquetas': {pt:'Etiquetas', en:'Tags', es:'Etiquetas', fr:'Étiquettes'},
  'Evolução Mensal': {pt:'Evolução Mensal', en:'Monthly Trend', es:'Evolución mensual', fr:'Évolution mensuelle'},
  'Evolução das categorias marcadas': {pt:'Evolução das categorias marcadas', en:'Tracked categories trend', es:'Evolución de categorías seguidas', fr:'Évolution des catégories suivies'},
  'Excluir Categoria': {pt:'Excluir Categoria', en:'Delete Category', es:'Eliminar categoría', fr:'Supprimer la catégorie'},
  'Excluir Conta': {pt:'Excluir Conta', en:'Delete Account', es:'Eliminar cuenta', fr:'Supprimer le compte'},
  'Excluir Grupo': {pt:'Excluir Grupo', en:'Delete Group', es:'Eliminar grupo', fr:'Supprimer le groupe'},
  'Excluir Orçamento': {pt:'Excluir Orçamento', en:'Delete Budget', es:'Eliminar presupuesto', fr:'Supprimer le budget'},
  'Excluir Transação': {pt:'Excluir Transação', en:'Delete Transaction', es:'Eliminar transacción', fr:'Supprimer la transaction'},
  'Excluída': {pt:'Excluída', en:'Deleted', es:'Eliminada', fr:'Supprimée'},
  'Exportar PDF': {pt:'Exportar PDF', en:'Export PDF', es:'Exportar PDF', fr:'Exporter PDF'},
  'Família preferida': {pt:'Família preferida', en:'Preferred family', es:'Familia preferida', fr:'Famille préférée'},
  'Fatura do cartão': {pt:'Fatura do cartão', en:'Card bill', es:'Factura de tarjeta', fr:'Facture de carte'},
  'Favoritas': {pt:'Favoritas', en:'Favorites', es:'Favoritas', fr:'Favoris'},
  'Fechar lista': {pt:'Fechar lista', en:'Close list', es:'Cerrar lista', fr:'Fermer la liste'},
  'Fluxo de Caixa': {pt:'Fluxo de Caixa', en:'Cash Flow', es:'Flujo de caja', fr:'Flux de trésorerie'},
  'Fluxo de Caixa e Gráficos': {pt:'Fluxo de Caixa e Gráficos', en:'Cash Flow & Charts', es:'Flujo de caja y gráficos', fr:'Flux de trésorerie et graphiques'},
  'Fonte pagadora': {pt:'Fonte pagadora', en:'Payer', es:'Fuente pagadora', fr:'Source de paiement'},
  'Foto': {pt:'Foto', en:'Photo', es:'Foto', fr:'Photo'},
  'Foto de perfil': {pt:'Foto de perfil', en:'Profile photo', es:'Foto de perfil', fr:'Photo de profil'},
  'Fundo': {pt:'Fundo', en:'Fund', es:'Fondo', fr:'Fonds'},
  'Grupo': {pt:'Grupo', en:'Group', es:'Grupo', fr:'Groupe'},
  'Grupo de contas': {pt:'Grupo de contas', en:'Account group', es:'Grupo de cuentas', fr:'Groupe de comptes'},
  'Grupo removido': {pt:'Grupo removido', en:'Group removed', es:'Grupo eliminado', fr:'Groupe supprimé'},
  'Grupo salvo!': {pt:'Grupo salvo!', en:'Group saved!', es:'¡Grupo guardado!', fr:'Groupe enregistré !'},
  'Histórico recente de lançamentos': {pt:'Histórico recente de lançamentos', en:'Recent transaction history', es:'Historial reciente de transacciones', fr:'Historique récent des transactions'},
  'IOF': {pt:'IOF', en:'IOF', es:'IOF', fr:'IOF'},
  'Imagem': {pt:'Imagem', en:'Image', es:'Imagen', fr:'Image'},
  'Inativos': {pt:'Inativos', en:'Inactive', es:'Inactivos', fr:'Inactifs'},
  'Informe o nome': {pt:'Informe o nome', en:'Enter the name', es:'Ingrese el nombre', fr:'Saisissez le nom'},
  'Integração com EmailJS': {pt:'Integração com EmailJS', en:'EmailJS integration', es:'Integración con EmailJS', fr:'Intégration EmailJS'},
  'Item adicionado': {pt:'Item adicionado', en:'Item added', es:'Artículo agregado', fr:'Article ajouté'},
  'Itens sem equivalência no catálogo de preços': {pt:'Itens sem equivalência no catálogo de preços', en:'Items without price catalog match', es:'Artículos sin equivalencia en el catálogo', fr:'Articles sans correspondance dans le catalogue'},
  'Limite': {pt:'Limite', en:'Limit', es:'Límite', fr:'Limite'},
  'Limpar': {pt:'Limpar', en:'Clear', es:'Limpiar', fr:'Effacer'},
  'Linhas': {pt:'Linhas', en:'Lines', es:'Líneas', fr:'Lignes'},
  'Logo': {pt:'Logo', en:'Logo', es:'Logo', fr:'Logo'},
  'Lucro/Prejuízo': {pt:'Lucro/Prejuízo', en:'Profit/Loss', es:'Ganancia/Pérdida', fr:'Profit/Perte'},
  'Marcar como confirmada': {pt:'Marcar como confirmada', en:'Mark as confirmed', es:'Marcar como confirmada', fr:'Marquer comme confirmée'},
  'Marcar como pendente': {pt:'Marcar como pendente', en:'Mark as pending', es:'Marcar como pendiente', fr:'Marquer comme en attente'},
  'Marcar tudo': {pt:'Marcar tudo', en:'Mark all', es:'Marcar todo', fr:'Tout cocher'},
  'Membro': {pt:'Membro', en:'Member', es:'Miembro', fr:'Membre'},
  'Membros': {pt:'Membros', en:'Members', es:'Miembros', fr:'Membres'},
  'Membros da família': {pt:'Membros da família', en:'Family members', es:'Miembros de la familia', fr:'Membres de la famille'},
  'Memo': {pt:'Memo', en:'Memo', es:'Memo', fr:'Mémo'},
  'Meses': {pt:'Meses', en:'Months', es:'Meses', fr:'Mois'},
  'Minha família': {pt:'Minha família', en:'My family', es:'Mi familia', fr:'Ma famille'},
  'Minhas Contas': {pt:'Minhas Contas', en:'My Accounts', es:'Mis cuentas', fr:'Mes comptes'},
  'Modo de câmbio': {pt:'Modo de câmbio', en:'Exchange mode', es:'Modo de cambio', fr:'Mode de change'},
  'Mês corrente': {pt:'Mês corrente', en:'Current month', es:'Mes corriente', fr:'Mois en cours'},
  'Módulos da Família': {pt:'Módulos da Família', en:'Family Modules', es:'Módulos de familia', fr:'Modules de la famille'},
  'Na lista': {pt:'Na lista', en:'In list', es:'En lista', fr:'Dans la liste'},
  'Nenhum beneficiário encontrado': {pt:'Nenhum beneficiário encontrado', en:'No payees found', es:'No se encontraron beneficiarios', fr:'Aucun bénéficiaire trouvé'},
  'Nenhum grupo criado ainda.': {pt:'Nenhum grupo criado ainda.', en:'No groups created yet.', es:'Aún no se han creado grupos.', fr:"Aucun groupe créé pour l\'instant."},
  'Nenhum registro encontrado': {pt:'Nenhum registro encontrado', en:'No records found', es:'No se encontraron registros', fr:'Aucun enregistrement trouvé'},
  'Nenhuma': {pt:'Nenhuma', en:'None', es:'Ninguna', fr:'Aucune'},
  'Nenhuma categoria encontrada': {pt:'Nenhuma categoria encontrada', en:'No categories found', es:'No se encontraron categorías', fr:'Aucune catégorie trouvée'},
  'Nenhuma transação no período': {pt:'Nenhuma transação no período', en:'No transactions in period', es:'Sin transacciones en el período', fr:'Aucune transaction dans la période'},
  'Nenhuma transação para este filtro': {pt:'Nenhuma transação para este filtro', en:'No transactions for this filter', es:'Sin transacciones para este filtro', fr:'Aucune transaction pour ce filtre'},
  'Nome atualizado': {pt:'Nome atualizado', en:'Name updated', es:'Nombre actualizado', fr:'Nom mis à jour'},
  'Nome de exibição': {pt:'Nome de exibição', en:'Display name', es:'Nombre de visualización', fr:"Nom d\'affichage"},
  'Notas': {pt:'Notas', en:'Notes', es:'Notas', fr:'Notes'},
  'Nova lista': {pt:'Nova lista', en:'New list', es:'Nueva lista', fr:'Nouvelle liste'},
  'Nova subcategoria': {pt:'Nova subcategoria', en:'New subcategory', es:'Nueva subcategoría', fr:'Nouvelle sous-catégorie'},
  'Novo Estabelecimento': {pt:'Novo Estabelecimento', en:'New Store', es:'Nuevo establecimiento', fr:'Nouvel établissement'},
  'Nunca': {pt:'Nunca', en:'Never', es:'Nunca', fr:'Jamais'},
  'Ontem': {pt:'Ontem', en:'Yesterday', es:'Ayer', fr:'Hier'},
  'Orçamento': {pt:'Orçamento', en:'Budget', es:'Presupuesto', fr:'Budget'},
  'Outro': {pt:'Outro', en:'Other', es:'Otro', fr:'Autre'},
  'Outros': {pt:'Outros', en:'Others', es:'Otros', fr:'Autres'},
  'Overdue': {pt:'Overdue', en:'Overdue', es:'Atrasado', fr:'En retard'},
  'Padrão': {pt:'Padrão', en:'Default', es:'Predeterminado', fr:'Par défaut'},
  'Pagamento de fatura': {pt:'Pagamento de fatura', en:'Bill payment', es:'Pago de factura', fr:'Paiement de facture'},
  'Papel': {pt:'Papel', en:'Role', es:'Rol', fr:'Rôle'},
  'Pausado': {pt:'Pausado', en:'Paused', es:'Pausado', fr:'En pause'},
  'País': {pt:'País', en:'Country', es:'País', fr:'Pays'},
  'Pendente de aprovação': {pt:'Pendente de aprovação', en:'Pending approval', es:'Pendiente de aprobación', fr:"En attente d\'approbation"},
  'Percentual': {pt:'Percentual', en:'Percentage', es:'Porcentaje', fr:'Pourcentage'},
  'Personalizar Dashboard': {pt:'Personalizar Dashboard', en:'Customize Dashboard', es:'Personalizar panel', fr:'Personnaliser le tableau de bord'},
  'Pessoa física': {pt:'Pessoa física', en:'Individual', es:'Persona física', fr:'Particulier'},
  'Pessoa jurídica': {pt:'Pessoa jurídica', en:'Company', es:'Empresa', fr:'Société'},
  'Pizza': {pt:'Pizza', en:'Pie', es:'Torta', fr:'Camembert'},
  'Preço': {pt:'Preço', en:'Price', es:'Precio', fr:'Prix'},
  'Preço médio de custo': {pt:'Preço médio de custo', en:'Average cost price', es:'Precio promedio de costo', fr:'Prix de revient moyen'},
  'Preço unitário': {pt:'Preço unitário', en:'Unit price', es:'Precio unitario', fr:'Prix unitaire'},
  'Programar': {pt:'Programar', en:'Schedule', es:'Programar', fr:'Programmer'},
  'Proprietário': {pt:'Proprietário', en:'Owner', es:'Propietario', fr:'Propriétaire'},
  'Próxima execução': {pt:'Próxima execução', en:'Next run', es:'Próxima ejecución', fr:'Prochaine exécution'},
  'Quantidade': {pt:'Quantidade', en:'Quantity', es:'Cantidad', fr:'Quantité'},
  'Quantidade de cotas': {pt:'Quantidade de cotas', en:'Number of units', es:'Cantidad de unidades', fr:"Nombre d\'unités"},
  'Quinzenal': {pt:'Quinzenal', en:'Biweekly', es:'Quincenal', fr:'Bimensuel'},
  'Recarregar': {pt:'Recarregar', en:'Reload', es:'Recargar', fr:'Recharger'},
  'Receitas por Categoria': {pt:'Receitas por Categoria', en:'Income by Category', es:'Ingresos por categoría', fr:'Revenus par catégorie'},
  'Receitas por categoria': {pt:'Receitas por categoria', en:'Income by category', es:'Ingresos por categoría', fr:'Revenus par catégorie'},
  'Reconciliada': {pt:'Reconciliada', en:'Reconciled', es:'Conciliada', fr:'Rapprochée'},
  'Registrar Compra com IA': {pt:'Registrar Compra com IA', en:'Register purchase with AI', es:'Registrar compra con IA', fr:"Enregistrer l\'achat avec IA"},
  'Registrar agora': {pt:'Registrar agora', en:'Register now', es:'Registrar ahora', fr:'Enregistrer maintenant'},
  'Registrar preço': {pt:'Registrar preço', en:'Record price', es:'Registrar precio', fr:'Enregistrer le prix'},
  'Remover': {pt:'Remover', en:'Remove', es:'Eliminar', fr:'Supprimer'},
  'Remover foto': {pt:'Remover foto', en:'Remove photo', es:'Quitar foto', fr:'Supprimer la photo'},
  'Renda Fixa': {pt:'Renda Fixa', en:'Fixed income', es:'Renta fija', fr:'Revenu fixe'},
  'Renda Variável': {pt:'Renda Variável', en:'Variable income', es:'Renta variable', fr:'Revenu variable'},
  'Rendimento': {pt:'Rendimento', en:'Yield', es:'Rendimiento', fr:'Rendement'},
  'Rentabilidade': {pt:'Rentabilidade', en:'Return', es:'Rentabilidad', fr:'Rendement'},
  'Repetir': {pt:'Repetir', en:'Repeat', es:'Repetir', fr:'Répéter'},
  'Repetições': {pt:'Repetições', en:'Repetitions', es:'Repeticiones', fr:'Répétitions'},
  'Restaurar Backup': {pt:'Restaurar Backup', en:'Restore backup', es:'Restaurar respaldo', fr:'Restaurer la sauvegarde'},
  'Resumo do Período': {pt:'Resumo do Período', en:'Period Summary', es:'Resumen del período', fr:'Résumé de la période'},
  'Rosca': {pt:'Rosca', en:'Donut', es:'Rosca', fr:'Anneau'},
  'Saldo Brasileiro (BRL)': {pt:'Saldo Brasileiro (BRL)', en:'Brazilian Balance (BRL)', es:'Saldo brasileño (BRL)', fr:'Solde brésilien (BRL)'},
  'Saldo atual': {pt:'Saldo atual', en:'Current balance', es:'Saldo actual', fr:'Solde actuel'},
  'Saldo da conta': {pt:'Saldo da conta', en:'Account balance', es:'Saldo de cuenta', fr:'Solde du compte'},
  'Saldo final': {pt:'Saldo final', en:'Final balance', es:'Saldo final', fr:'Solde final'},
  'Saldo previsto': {pt:'Saldo previsto', en:'Projected balance', es:'Saldo previsto', fr:'Solde prévu'},
  'Salvo': {pt:'Salvo', en:'Saved', es:'Guardado', fr:'Enregistré'},
  'Salvo com sucesso': {pt:'Salvo com sucesso', en:'Saved successfully', es:'Guardado con éxito', fr:'Enregistré avec succès'},
  'Selecionar': {pt:'Selecionar', en:'Select', es:'Seleccionar', fr:'Sélectionner'},
  'Selecione a categoria destino': {pt:'Selecione a categoria destino', en:'Select target category', es:'Seleccione la categoría destino', fr:'Sélectionnez la catégorie cible'},
  'Sem beneficiário': {pt:'Sem beneficiário', en:'No payee', es:'Sin beneficiario', fr:'Sans bénéficiaire'},
  'Sem categoria': {pt:'Sem categoria', en:'No category', es:'Sin categoría', fr:'Sans catégorie'},
  'Sem data de fim': {pt:'Sem data de fim', en:'No end date', es:'Sin fecha de fin', fr:'Sans date de fin'},
  'Sem subcategorias': {pt:'Sem subcategorias', en:'No subcategories', es:'Sin subcategorías', fr:'Aucune sous-catégorie'},
  'Sem transações': {pt:'Sem transações', en:'No transactions', es:'Sin transacciones', fr:'Aucune transaction'},
  'Semanas': {pt:'Semanas', en:'Weeks', es:'Semanas', fr:'Semaines'},
  'Sempre': {pt:'Sempre', en:'Always', es:'Siempre', fr:'Toujours'},
  'Sempre visível': {pt:'Sempre visível', en:'Always visible', es:'Siempre visible', fr:'Toujours visible'},
  'Senha atual': {pt:'Senha atual', en:'Current password', es:'Contraseña actual', fr:'Mot de passe actuel'},
  'Sincronizar': {pt:'Sincronizar', en:'Sync', es:'Sincronizar', fr:'Synchroniser'},
  'Site': {pt:'Site', en:'Website', es:'Sitio web', fr:'Site web'},
  'Subcategoria': {pt:'Subcategoria', en:'Subcategory', es:'Subcategoría', fr:'Sous-catégorie'},
  'Subcategorias': {pt:'Subcategorias', en:'Subcategories', es:'Subcategorías', fr:'Sous-catégories'},
  'Subtotal': {pt:'Subtotal', en:'Subtotal', es:'Subtotal', fr:'Sous-total'},
  'Tag': {pt:'Tag', en:'Tag', es:'Etiqueta', fr:'Étiquette'},
  'Tags': {pt:'Tags', en:'Tags', es:'Etiquetas', fr:'Étiquettes'},
  'Taxa de câmbio': {pt:'Taxa de câmbio', en:'Exchange rate', es:'Tipo de cambio', fr:'Taux de change'},
  'Telefone': {pt:'Telefone', en:'Phone', es:'Teléfono', fr:'Téléphone'},
  'Tema claro': {pt:'Tema claro', en:'Light theme', es:'Tema claro', fr:'Thème clair'},
  'Tema escuro': {pt:'Tema escuro', en:'Dark theme', es:'Tema oscuro', fr:'Thème sombre'},
  'Testar': {pt:'Testar', en:'Test', es:'Probar', fr:'Tester'},
  'Teste': {pt:'Teste', en:'Test', es:'Prueba', fr:'Test'},
  'Ticker': {pt:'Ticker', en:'Ticker', es:'Símbolo', fr:'Symbole'},
  'Tipo de categoria': {pt:'Tipo de categoria', en:'Category type', es:'Tipo de categoría', fr:'Type de catégorie'},
  'Todas as categorias': {pt:'Todas as categorias', en:'All categories', es:'Todas las categorías', fr:'Toutes les catégories'},
  'Token': {pt:'Token', en:'Token', es:'Token', fr:'Token'},
  'Total em BRL': {pt:'Total em BRL', en:'Total in BRL', es:'Total en BRL', fr:'Total en BRL'},
  'Transação': {pt:'Transação', en:'Transaction', es:'Transacción', fr:'Transaction'},
  'Transações Programadas': {pt:'Transações Programadas', en:'Scheduled Transactions', es:'Transacciones programadas', fr:'Transactions programmées'},
  'Transferências': {pt:'Transferências', en:'Transfers', es:'Transferencias', fr:'Virements'},
  'URL': {pt:'URL', en:'URL', es:'URL', fr:'URL'},
  'Usuário': {pt:'Usuário', en:'User', es:'Usuario', fr:'Utilisateur'},
  'Valor atual': {pt:'Valor atual', en:'Current value', es:'Valor actual', fr:'Valeur actuelle'},
  'Ver': {pt:'Ver', en:'View', es:'Ver', fr:'Voir'},
  'Ver histórico': {pt:'Ver histórico', en:'View history', es:'Ver historial', fr:"Voir l\'historique"},
  'Ver mais': {pt:'Ver mais', en:'View more', es:'Ver más', fr:'Voir plus'},
  'Vincular transferência': {pt:'Vincular transferência', en:'Link transfer', es:'Vincular transferencia', fr:'Lier le virement'},
  'Visualizador': {pt:'Visualizador', en:'Viewer', es:'Visualizador', fr:'Lecteur'},
  'WhatsApp': {pt:'WhatsApp', en:'WhatsApp', es:'WhatsApp', fr:'WhatsApp'},
  'registros': {pt:'registros', en:'records', es:'registros', fr:'enregistrements'},
  'saldo final prev.': {pt:'saldo final prev.', en:'projected balance', es:'saldo final prev.', fr:'solde final prévu'},
  'transação': {pt:'transação', en:'transaction', es:'transacción', fr:'transaction'},
  'transações': {pt:'transações', en:'transactions', es:'transacciones', fr:'transactions'},
  'Ícone': {pt:'Ícone', en:'Icon', es:'Ícono', fr:'Icône'},
  'Última conta usada:': {pt:'Última conta usada:', en:'Last account used:', es:'Última cuenta usada:', fr:'Dernier compte utilisé:'},
  'Última execução': {pt:'Última execução', en:'Last run', es:'Última ejecución', fr:'Dernière exécution'},
  'Último preço': {pt:'Último preço', en:'Last price', es:'Último precio', fr:'Dernier prix'},


  
  // ── DEBTS MODULE ────────────────────────────────────────────────────────────
  'nav.debts':              {pt:'Dívidas',              en:'Debts',             es:'Deudas',               fr:'Dettes'},
  'dbt.title':              {pt:'Dívidas',              en:'Debts',             es:'Deudas',               fr:'Dettes'},
  'dbt.add':                {pt:'Nova Dívida',          en:'New Debt',          es:'Nueva deuda',           fr:'Nouvelle dette'},
  'dbt.edit':               {pt:'Editar Dívida',        en:'Edit Debt',         es:'Editar deuda',          fr:'Modifier dette'},
  'dbt.name':               {pt:'Nome da dívida',       en:'Debt name',         es:'Nombre de la deuda',    fr:'Nom de la dette'},
  'dbt.name_placeholder':   {pt:'Ex: Financiamento casa', en:'e.g. Mortgage',  es:'Ej: Hipoteca',          fr:'Ex: Prêt immobilier'},
  'dbt.creditor':           {pt:'Credor',               en:'Creditor',          es:'Acreedor',             fr:'Créancier'},
  'dbt.add_creditor':       {pt:'Novo credor',          en:'New creditor',      es:'Nuevo acreedor',       fr:'Nouveau créancier'},
  'dbt.original_amount':    {pt:'Valor original',       en:'Original amount',   es:'Monto original',       fr:'Montant original'},
  'dbt.current_balance':    {pt:'Saldo atual',          en:'Current balance',   es:'Saldo actual',         fr:'Solde actuel'},
  'dbt.original':           {pt:'Original',             en:'Original',          es:'Original',             fr:'Original'},
  'dbt.amortized':          {pt:'Amortizado',           en:'Amortized',         es:'Amortizado',           fr:'Amorti'},
  'dbt.balance':            {pt:'Saldo',                en:'Balance',           es:'Saldo',                fr:'Solde'},
  'dbt.start_date':         {pt:'Data de início',       en:'Start date',        es:'Fecha de inicio',      fr:'Date de début'},
  'dbt.contract_ref':       {pt:'Nº contrato / ref.',   en:'Contract / ref. no.',es:'Nº contrato / ref.', fr:"N° contrat / réf."},
  'dbt.index_type':         {pt:'Índice de correção',   en:'Adjustment index',  es:'Índice de ajuste',     fr:"Indice d'ajustement"},
  'dbt.periodicity':        {pt:'Periodicidade',        en:'Periodicity',       es:'Periodicidad',         fr:'Périodicité'},
  'dbt.fixed_rate':         {pt:'Taxa de juros',        en:'Interest rate',     es:'Tasa de interés',      fr:"Taux d'intérêt"},
  'dbt.rate_applied':       {pt:'Taxa aplicada (%)',    en:'Rate applied (%)',  es:'Tasa aplicada (%)',    fr:'Taux appliqué (%)'},
  'dbt.total_adjustments':  {pt:'Total corrigido',      en:'Total adjusted',    es:'Total ajustado',       fr:'Total ajusté'},
  'dbt.total_amortized':    {pt:'Total amortizado',     en:'Total amortized',   es:'Total amortizado',     fr:'Total amorti'},
  'dbt.ledger':             {pt:'Histórico de entradas',en:'Ledger entries',    es:'Historial de entradas',fr:'Journal des entrées'},
  'dbt.no_entries':         {pt:'Nenhum lançamento',   en:'No entries yet',    es:'Sin entradas',         fr:'Aucune entrée'},
  'dbt.manual_entry':       {pt:'Lançamento manual',   en:'Manual entry',      es:'Entrada manual',       fr:'Entrée manuelle'},
  'dbt.settle':             {pt:'Quitar dívida',        en:'Settle debt',       es:'Liquidar deuda',       fr:'Solder la dette'},
  'dbt.entry_type':         {pt:'Tipo de lançamento',  en:'Entry type',        es:'Tipo de entrada',      fr:"Type d'entrée"},
  'dbt.entry_opening':      {pt:'Abertura da dívida',  en:'Debt opening',      es:'Apertura de deuda',    fr:'Ouverture de la dette'},
  'dbt.entry_interest':     {pt:'Juros —',             en:'Interest —',        es:'Interés —',            fr:'Intérêts —'},
  'dbt.entry_amortization': {pt:'Amortização via transação', en:'Amortization via transaction', es:'Amortización vía transacción', fr:"Amortissement via transaction"},
  'dbt.entry_settlement':   {pt:'Quitação final',      en:'Final settlement',  es:'Liquidación final',    fr:'Liquidation finale'},
  'dbt.entry_saved':        {pt:'Lançamento salvo!',   en:'Entry saved!',      es:'¡Entrada guardada!',   fr:'Entrée enregistrée !'},
  'dbt.saved':              {pt:'Dívida salva!',       en:'Debt saved!',       es:'¡Deuda guardada!',     fr:'Dette enregistrée !'},
  'dbt.settled_toast':      {pt:'Dívida quitada!',     en:'Debt settled!',     es:'¡Deuda liquidada!',    fr:'Dette soldée !'},
  'dbt.confirm_settle':     {pt:'Confirmar quitação da dívida? Esta ação registrará o saldo restante como quitado.', en:'Confirm debt settlement? This will record the remaining balance as settled.', es:'¿Confirmar liquidación de la deuda? Se registrará el saldo restante como liquidado.', fr:'Confirmer la liquidation de la dette ? Le solde restant sera enregistré comme soldé.'},
  'dbt.update_now':         {pt:'Atualizar índices',   en:'Update indices',    es:'Actualizar índices',   fr:'Mettre à jour les indices'},
  'dbt.update_running':     {pt:'Atualização em curso…',en:'Update running…', es:'Actualización en curso…',fr:'Mise à jour en cours…'},
  'dbt.update_done':        {pt:'Atualização concluída',en:'Update complete',  es:'Actualización completada',fr:'Mise à jour terminée'},
  'dbt.updated':            {pt:'atualizadas',         en:'updated',           es:'actualizadas',         fr:'mises à jour'},
  'dbt.failed':             {pt:'com falha',           en:'failed',            es:'con error',            fr:'échouées'},
  'dbt.update_error':       {pt:'Erro ao atualizar dívidas', en:'Error updating debts', es:'Error al actualizar deudas', fr:'Erreur lors de la mise à jour des dettes'},
  'dbt.no_active':          {pt:'Nenhuma dívida ativa para atualizar', en:'No active debts to update', es:'Sin deudas activas para actualizar', fr:'Aucune dette active à mettre à jour'},
  'dbt.empty':              {pt:'Nenhuma dívida cadastrada. Clique em + Nova Dívida para começar.', en:'No debts registered. Click + New Debt to start.', es:'Sin deudas registradas. Haga clic en + Nueva deuda para comenzar.', fr:'Aucune dette enregistrée. Cliquez sur + Nouvelle dette pour commencer.'},
  'dbt.kpi_total_active':   {pt:'Total em dívidas',   en:'Total in debts',    es:'Total en deudas',      fr:'Total en dettes'},
  'dbt.kpi_count':          {pt:'Dívidas ativas',     en:'Active debts',      es:'Deudas activas',       fr:'Dettes actives'},
  'dbt.kpi_settled':        {pt:'Quitadas',           en:'Settled',           es:'Liquidadas',           fr:'Soldées'},
  'dbt.enabled_toast':      {pt:'✓ Módulo de Dívidas ativado', en:'✓ Debts module enabled', es:'✓ Módulo de deudas activado', fr:'✓ Module dettes activé'},
  'dbt.disabled_toast':     {pt:'Módulo de Dívidas desativado', en:'Debts module disabled', es:'Módulo de deudas desactivado', fr:'Module dettes désactivé'},
  'dbt.err_name':           {pt:'Informe o nome da dívida', en:'Enter the debt name', es:'Ingrese el nombre de la deuda', fr:'Saisissez le nom de la dette'},
  'dbt.err_creditor':       {pt:'Selecione o credor', en:'Select the creditor', es:'Seleccione el acreedor', fr:'Sélectionnez le créancier'},
  'dbt.err_amount':         {pt:'Informe um valor original válido', en:'Enter a valid original amount', es:'Ingrese un monto original válido', fr:'Saisissez un montant original valide'},
  'dbt.err_start_date':     {pt:'Informe a data de início', en:'Enter the start date', es:'Ingrese la fecha de inicio', fr:'Saisissez la date de début'},
  'dbt.err_fixed_rate':     {pt:'Informe a taxa de juros para juros fixos', en:'Enter the interest rate for fixed rate', es:'Ingrese la tasa de interés para tasa fija', fr:"Saisissez le taux d'intérêt pour taux fixe"},
  'dbt.err_entry':          {pt:'Informe data e valor válidos', en:'Enter a valid date and amount', es:'Ingrese una fecha y monto válidos', fr:'Saisissez une date et un montant valides'},
  'dbt.err_save':           {pt:'Erro ao salvar', en:'Error saving', es:'Error al guardar', fr:"Erreur lors de l'enregistrement"},
  'dbt.amort_prompt_title': {pt:'Este beneficiário é credor de uma dívida ativa', en:'This payee is a creditor on an active debt', es:'Este beneficiario es acreedor de una deuda activa', fr:"Ce bénéficiaire est créancier d'une dette active"},
  'dbt.amort_prompt_sub':   {pt:'Este lançamento é uma amortização de dívida?', en:'Is this transaction a debt amortization?', es:'¿Esta transacción es una amortización de deuda?', fr:'Cette transaction est-elle un remboursement de dette ?'},
  'dbt.amort_confirm':      {pt:'Sim, amortizar', en:'Yes, amortize', es:'Sí, amortizar', fr:'Oui, amortir'},
  'dbt.amort_linked':       {pt:'Amortização vinculada', en:'Amortization linked', es:'Amortización vinculada', fr:'Amortissement lié'},
  'dbt.amort_set':          {pt:'Dívida vinculada — ao salvar, o saldo será atualizado', en:'Debt linked — balance will update on save', es:'Deuda vinculada — el saldo se actualizará al guardar', fr:"Dette liée — le solde sera mis à jour à l'enregistrement"},
  'dbt.amort_posted':       {pt:'Amortização registrada na dívida!', en:'Amortization recorded on debt!', es:'¡Amortización registrada en la deuda!', fr:'Amortissement enregistré sur la dette !'},
  // Amortização de Dívida category name
  'cat.debt_amort':         {pt:'Amortização de Dívida', en:'Debt Amortization', es:'Amortización de deuda', fr:'Amortissement de dette'},

// ── Additional UI strings (comprehensive sweep) ────────────────────────────
  'Ajuda':                        {pt:'Ajuda',                          en:'Help',                         es:'Ayuda',                         fr:'Aide'},
  'Central de Ajuda':             {pt:'Central de Ajuda',               en:'Help Center',                  es:'Centro de ayuda',               fr:"Centre d'aide"},
  'Ajuste de saldo':              {pt:'Ajuste de saldo',                en:'Balance adjustment',           es:'Ajuste de saldo',               fr:'Ajustement de solde'},
  'Analisar & Prévia':            {pt:'Analisar & Prévia',              en:'Analyze & Preview',            es:'Analizar y vista previa',       fr:'Analyser et aperçu'},
  'Análise por Categoria':        {pt:'Análise por Categoria',          en:'Analysis by Category',         es:'Análisis por categoría',        fr:'Analyse par catégorie'},
  'Análise inteligente com IA':   {pt:'Análise inteligente com IA',     en:'Smart AI analysis',            es:'Análisis inteligente con IA',   fr:"Analyse intelligente avec l'IA"},
  'Atualizar cotações':           {pt:'Atualizar cotações',             en:'Update quotes',                es:'Actualizar cotizaciones',       fr:'Mettre à jour les cours'},
  'Automóvel':                    {pt:'Automóvel',                      en:'Vehicle',                      es:'Automóvil',                     fr:'Automobile'},
  'Arquivo de backup inválido ou incompleto.': {pt:'Arquivo de backup inválido ou incompleto.', en:'Invalid or incomplete backup file.', es:'Archivo de respaldo inválido.', fr:'Fichier de sauvegarde invalide.'},
  'Arquivo muito grande (máximo 10 MB)': {pt:'Arquivo muito grande (máximo 10 MB)', en:'File too large (maximum 10 MB)', es:'Archivo demasiado grande (máx. 10 MB)', fr:'Fichier trop volumineux (max. 10 Mo)'},
  'As senhas não coincidem.':     {pt:'As senhas não coincidem.',       en:'Passwords do not match.',      es:'Las contraseñas no coinciden.', fr:'Les mots de passe ne correspondent pas.'},
  'As senhas não conferem.':      {pt:'As senhas não conferem.',        en:'Passwords do not match.',      es:'Las contraseñas no coinciden.', fr:'Les mots de passe ne correspondent pas.'},
  'Beneficiário / Fornecedor':    {pt:'Beneficiário / Fornecedor',      en:'Payee / Supplier',             es:'Beneficiario / Proveedor',      fr:'Bénéficiaire / Fournisseur'},
  'Beneficiários...':             {pt:'Beneficiários...',               en:'Payees...',                    es:'Beneficiarios...',              fr:'Bénéficiaires...'},
  'CSV Genérico':                 {pt:'CSV Genérico',                   en:'Generic CSV',                  es:'CSV genérico',                  fr:'CSV générique'},
  'Carregando beneficiários…':    {pt:'Carregando beneficiários…',      en:'Loading payees…',              es:'Cargando beneficiarios…',       fr:'Chargement des bénéficiaires…'},
  'Carregando categorias…':       {pt:'Carregando categorias…',         en:'Loading categories…',          es:'Cargando categorías…',          fr:'Chargement des catégories…'},
  'Carregando contas…':           {pt:'Carregando contas…',             en:'Loading accounts…',            es:'Cargando cuentas…',             fr:'Chargement des comptes…'},
  'Carregando transações…':       {pt:'Carregando transações…',         en:'Loading transactions…',        es:'Cargando transacciones…',       fr:'Chargement des transactions…'},
  'Chave API inválida.':          {pt:'Chave API inválida.',            en:'Invalid API key.',             es:'Clave API inválida.',           fr:'Clé API invalide.'},
  'Confirmar exclusão':           {pt:'Confirmar exclusão',             en:'Confirm deletion',             es:'Confirmar eliminación',         fr:'Confirmer la suppression'},
  'Conta inválida':               {pt:'Conta inválida',                 en:'Invalid account',              es:'Cuenta inválida',               fr:'Compte invalide'},
  'Contas...':                    {pt:'Contas...',                      en:'Accounts...',                  es:'Cuentas...',                    fr:'Comptes...'},
  'Cor do grupo':                 {pt:'Cor do grupo',                   en:'Group color',                  es:'Color del grupo',               fr:'Couleur du groupe'},
  'Data de início':               {pt:'Data de início',                 en:'Start date',                   es:'Fecha de inicio',               fr:'Date de début'},
  'Data real':                    {pt:'Data real',                      en:'Actual date',                  es:'Fecha real',                    fr:'Date réelle'},
  'Desconto':                     {pt:'Desconto',                       en:'Discount',                     es:'Descuento',                     fr:'Remise'},
  'Deseja excluir este lançamento?': {pt:'Deseja excluir este lançamento?', en:'Delete this transaction?', es:'¿Eliminar esta transacción?', fr:'Supprimer cette transaction?'},
  'Distribuição por Categoria':   {pt:'Distribuição por Categoria',     en:'Distribution by Category',     es:'Distribución por categoría',    fr:'Distribution par catégorie'},
  'Email enviado!':               {pt:'Email enviado!',                 en:'Email sent!',                  es:'¡Email enviado!',               fr:'Email envoyé !'},
  'Erro ao criar conta':          {pt:'Erro ao criar conta',            en:'Error creating account',       es:'Error al crear cuenta',         fr:'Erreur lors de la création du compte'},
  'Estabelecimento':              {pt:'Estabelecimento',                en:'Store',                        es:'Establecimiento',               fr:'Établissement'},
  'Extrato':                      {pt:'Extrato',                        en:'Statement',                    es:'Extracto',                      fr:'Relevé'},
  'Família não encontrada':       {pt:'Família não encontrada',         en:'Family not found',             es:'Familia no encontrada',         fr:'Famille introuvable'},
  'Favorito':                     {pt:'Favorito',                       en:'Favorite',                     es:'Favorito',                      fr:'Favori'},
  'Frequência':                   {pt:'Frequência',                     en:'Frequency',                    es:'Frecuencia',                    fr:'Fréquence'},
  'Gastos por Conta':             {pt:'Gastos por Conta',               en:'Expenses by Account',          es:'Gastos por cuenta',             fr:'Dépenses par compte'},
  'Gastos por Membro':            {pt:'Gastos por Membro',              en:'Expenses by Member',           es:'Gastos por miembro',            fr:'Dépenses par membre'},
  'Histórico de preços':          {pt:'Histórico de preços',            en:'Price history',                es:'Historial de precios',          fr:'Historique des prix'},
  'Incluir transferências':       {pt:'Incluir transferências',         en:'Include transfers',            es:'Incluir transferencias',        fr:'Inclure les virements'},
  'Informe a conta':              {pt:'Informe a conta',                en:'Enter the account',            es:'Ingrese la cuenta',             fr:'Saisissez le compte'},
  'Informe a data':               {pt:'Informe a data',                 en:'Enter the date',               es:'Ingrese la fecha',              fr:'Saisissez la date'},
  'Informe o valor':              {pt:'Informe o valor',                en:'Enter the amount',             es:'Ingrese el monto',              fr:'Saisissez le montant'},
  'Intervalo':                    {pt:'Intervalo',                      en:'Interval',                     es:'Intervalo',                     fr:'Intervalle'},
  'Investimento salvo!':          {pt:'Investimento salvo!',            en:'Investment saved!',            es:'¡Inversión guardada!',          fr:'Investissement enregistré !'},
  'Limite mensal':                {pt:'Limite mensal',                  en:'Monthly limit',                es:'Límite mensual',                fr:'Limite mensuelle'},
  'Lista de compras':             {pt:'Lista de compras',               en:'Shopping list',                es:'Lista de compras',              fr:'Liste de courses'},
  'Membros da família':           {pt:'Membros da família',             en:'Family members',               es:'Miembros de la familia',        fr:'Membres de la famille'},
  'Modo Reconciliação':           {pt:'Modo Reconciliação',             en:'Reconciliation Mode',          es:'Modo Conciliación',             fr:'Mode Rapprochement'},
  'Moeda da conta':               {pt:'Moeda da conta',                 en:'Account currency',             es:'Moneda de la cuenta',           fr:'Devise du compte'},
  'Nenhum dado disponível':       {pt:'Nenhum dado disponível',         en:'No data available',            es:'No hay datos disponibles',      fr:'Aucune donnée disponible'},
  'Nenhum item na lista':         {pt:'Nenhum item na lista',           en:'No items in list',             es:'No hay artículos en la lista',  fr:'Aucun article dans la liste'},
  'Nova senha':                   {pt:'Nova senha',                     en:'New password',                 es:'Nueva contraseña',              fr:'Nouveau mot de passe'},
  'Número de parcelas':           {pt:'Número de parcelas',             en:'Number of installments',       es:'Número de cuotas',              fr:'Nombre de mensualités'},
  'Parcelado':                    {pt:'Parcelado',                      en:'Installments',                 es:'En cuotas',                     fr:'En mensualités'},
  'Parcelas':                     {pt:'Parcelas',                       en:'Installments',                 es:'Cuotas',                        fr:'Mensualités'},
  'Período de análise':           {pt:'Período de análise',             en:'Analysis period',              es:'Período de análisis',           fr:"Période d'analyse"},
  'Pizza':                        {pt:'Pizza',                          en:'Pie',                          es:'Torta',                         fr:'Camembert'},
  'Planejamento':                 {pt:'Planejamento',                   en:'Planning',                     es:'Planificación',                 fr:'Planification'},
  'Por conta':                    {pt:'Por conta',                      en:'By account',                   es:'Por cuenta',                    fr:'Par compte'},
  'Progresso':                    {pt:'Progresso',                      en:'Progress',                     es:'Progreso',                      fr:'Progrès'},
  'Próximo vencimento':           {pt:'Próximo vencimento',             en:'Next due date',                es:'Próximo vencimiento',           fr:'Prochaine échéance'},
  'Recorrência':                  {pt:'Recorrência',                    en:'Recurrence',                   es:'Recurrencia',                   fr:'Récurrence'},
  'Resultado do período':         {pt:'Resultado do período',           en:'Period result',                es:'Resultado del período',         fr:'Résultat de la période'},
  'Salvo!':                       {pt:'Salvo!',                         en:'Saved!',                       es:'¡Guardado!',                    fr:'Enregistré !'},
  'Selecione a conta':            {pt:'Selecione a conta',              en:'Select the account',           es:'Seleccione la cuenta',          fr:'Sélectionnez le compte'},
  'Selecione o período':          {pt:'Selecione o período',            en:'Select the period',            es:'Seleccione el período',         fr:'Sélectionnez la période'},
  'Sem dados':                    {pt:'Sem dados',                      en:'No data',                      es:'Sin datos',                     fr:'Aucune donnée'},
  'Sem despesas no mês':          {pt:'Sem despesas no mês',            en:'No expenses this month',       es:'Sin gastos este mes',           fr:'Aucune dépense ce mois'},
  'Saldo do mês':                 {pt:'Saldo do mês',                   en:'Monthly balance',              es:'Saldo del mes',                 fr:'Solde du mois'},
  'Taxa de câmbio':               {pt:'Taxa de câmbio',                 en:'Exchange rate',                es:'Tipo de cambio',                fr:'Taux de change'},
  'Transação salva!':             {pt:'Transação salva!',               en:'Transaction saved!',           es:'¡Transacción guardada!',        fr:'Transaction enregistrée !'},
  'Transferir para':              {pt:'Transferir para',                en:'Transfer to',                  es:'Transferir a',                  fr:'Virer vers'},
  'Tipo de investimento':         {pt:'Tipo de investimento',           en:'Investment type',              es:'Tipo de inversión',             fr:"Type d'investissement"},
  'Usuário não encontrado':       {pt:'Usuário não encontrado',         en:'User not found',               es:'Usuario no encontrado',         fr:'Utilisateur introuvable'},
  'Variação':                     {pt:'Variação',                       en:'Change',                       es:'Variación',                     fr:'Variation'},
  'Valor inválido':               {pt:'Valor inválido',                 en:'Invalid amount',               es:'Monto inválido',                fr:'Montant invalide'},
  'Ver lançamentos':              {pt:'Ver lançamentos',                en:'View transactions',            es:'Ver transacciones',             fr:'Voir les transactions'},
  'Ver transações':               {pt:'Ver transações',                 en:'View transactions',            es:'Ver transacciones',             fr:'Voir les transactions'},
  'Você não tem permissão':       {pt:'Você não tem permissão',         en:'You do not have permission',   es:'No tiene permiso',              fr:"Vous n'avez pas la permission"},
  'Última atualização':           {pt:'Última atualização',             en:'Last update',                  es:'Última actualización',          fr:'Dernière mise à jour'},
  'Últimas transações':           {pt:'Últimas transações',             en:'Latest transactions',          es:'Últimas transacciones',         fr:'Dernières transactions'},
  'lançamento':                   {pt:'lançamento',                     en:'transaction',                  es:'transacción',                   fr:'transaction'},
  'lançamentos':                  {pt:'lançamentos',                    en:'transactions',                 es:'transacciones',                 fr:'transactions'},
  'sem categoria':                {pt:'sem categoria',                  en:'no category',                  es:'sin categoría',                 fr:'sans catégorie'},
  'transferência':                {pt:'transferência',                  en:'transfer',                     es:'transferencia',                 fr:'virement'},
  '← Voltar':                     {pt:'← Voltar',                       en:'← Back',                       es:'← Volver',                      fr:'← Retour'},


  // ── v15 additions: missing toasts, errors, form labels ─────────────────
  'AI Insights não está habilitado para esta família': {pt:'AI Insights não está habilitado para esta família', en:'AI Insights is not enabled for this family', es:'AI Insights no está habilitado para esta familia', fr:'AI Insights n\'est pas activé pour cette famille'},
  'Acesso restrito': {pt:'Acesso restrito', en:'Restricted access', es:'Acceso restringido', fr:'Accès restreint'},
  'Acesso restrito a administradores': {pt:'Acesso restrito a administradores', en:'Restricted to administrators', es:'Acceso restringido a administradores', fr:'Accès restreint aux administrateurs'},
  'Anexo removido': {pt:'Anexo removido', en:'Attachment removed', es:'Adjunto eliminado', fr:'Pièce jointe supprimée'},
  'Apenas Administradores globais podem copiar dados de famílias': {pt:'Apenas Administradores globais podem copiar dados de famílias', en:'Only global Administrators can copy family data', es:'Solo los Administradores globales pueden copiar datos de familias', fr:'Seuls les administrateurs globaux peuvent copier les données des familles'},
  'Apenas administradores podem alterar esta configuração': {pt:'Apenas administradores podem alterar esta configuração', en:'Only administrators can change this setting', es:'Solo los administradores pueden cambiar esta configuración', fr:'Seuls les administrateurs peuvent modifier ce paramètre'},
  'Apenas administradores podem executar esta função.': {pt:'Apenas administradores podem executar esta função.', en:'Only administrators can run this function.', es:'Solo los administradores pueden ejecutar esta función.', fr:'Seuls les administrateurs peuvent exécuter cette fonction.'},
  'Apenas admins ou o owner da família podem excluir': {pt:'Apenas admins ou o owner da família podem excluir', en:'Only admins or the family owner can delete', es:'Solo los admins o el propietario de la familia pueden eliminar', fr:'Seuls les admins ou le propriétaire de la famille peuvent supprimer'},
  'Apenas o owner da família pode limpar os dados': {pt:'Apenas o owner da família pode limpar os dados', en:'Only the family owner can clear the data', es:'Solo el propietario de la familia puede limpiar los datos', fr:'Seul le propriétaire de la famille peut effacer les données'},
  'Apenas o owner pode convidar': {pt:'Apenas o owner pode convidar', en:'Only the owner can invite', es:'Solo el propietario puede invitar', fr:'Seul le propriétaire peut inviter'},
  'Apenas owners podem gerenciar módulos.': {pt:'Apenas owners podem gerenciar módulos.', en:'Only owners can manage modules.', es:'Solo los propietarios pueden gestionar módulos.', fr:'Seuls les propriétaires peuvent gérer les modules.'},
  'Aviso:': {pt:'Aviso:', en:'Warning:', es:'Aviso:', fr:'Avertissement :'},
  'Backup exportado!': {pt:'Backup exportado!', en:'Backup exported!', es:'¡Respaldo exportado!', fr:'Sauvegarde exportée !'},
  'Beneficiário excluído e registros transferidos!': {pt:'Beneficiário excluído e registros transferidos!', en:'Payee deleted and records transferred!', es:'¡Beneficiario eliminado y registros transferidos!', fr:'Bénéficiaire supprimé et enregistrements transférés !'},
  'Chave API inválida. Verifique em Configurações.': {pt:'Chave API inválida. Verifique em Configurações.', en:'Invalid API key. Check Settings.', es:'Clave API inválida. Verifique en Configuración.', fr:'Clé API invalide. Vérifiez dans Paramètres.'},
  'Chave inválida — deve começar com AIza…': {pt:'Chave inválida — deve começar com AIza…', en:'Invalid key — must start with AIza…', es:'Clave inválida — debe comenzar con AIza…', fr:'Clé invalide — doit commencer par AIza…'},
  'Chave removida': {pt:'Chave removida', en:'Key removed', es:'Clave eliminada', fr:'Clé supprimée'},
  'Configuração de acesso salva ✓': {pt:'Configuração de acesso salva ✓', en:'Access settings saved ✓', es:'Configuración de acceso guardada ✓', fr:'Paramètres d\'accès enregistrés ✓'},
  'Configuração de automação salva': {pt:'Configuração de automação salva', en:'Automation settings saved', es:'Configuración de automatización guardada', fr:'Paramètres d\'automatisation enregistrés'},
  'Configure a chave Gemini': {pt:'Configure a chave Gemini', en:'Configure the Gemini key', es:'Configure la clave Gemini', fr:'Configurez la clé Gemini'},
  'Configure a chave Gemini em Configurações → IA.': {pt:'Configure a chave Gemini em Configurações → IA.', en:'Configure the Gemini key in Settings → AI.', es:'Configure la clave Gemini en Configuración → IA.', fr:'Configurez la clé Gemini dans Paramètres → IA.'},
  'Configure a chave Gemini para usar IA.': {pt:'Configure a chave Gemini para usar IA.', en:'Configure the Gemini key to use AI.', es:'Configure la clave Gemini para usar IA.', fr:'Configurez la clé Gemini pour utiliser l\'IA.'},
  'Configure o EmailJS primeiro': {pt:'Configure o EmailJS primeiro', en:'Configure EmailJS first', es:'Configure EmailJS primero', fr:'Configurez EmailJS d\'abord'},
  'Configure o EmailJS primeiro (botão ⚙️)': {pt:'Configure o EmailJS primeiro (botão ⚙️)', en:'Configure EmailJS first (⚙️ button)', es:'Configure EmailJS primero (botón ⚙️)', fr:'Configurez EmailJS d\'abord (bouton ⚙️)'},
  'Configure o Supabase primeiro': {pt:'Configure o Supabase primeiro', en:'Configure Supabase first', es:'Configure Supabase primero', fr:'Configurez Supabase d\'abord'},
  'Conta da transação original não encontrada.': {pt:'Conta da transação original não encontrada.', en:'Original transaction account not found.', es:'Cuenta de la transacción original no encontrada.', fr:'Compte de la transaction originale introuvable.'},
  'Conta origem e destino não podem ser iguais': {pt:'Conta origem e destino não podem ser iguais', en:'Source and destination accounts cannot be the same', es:'Las cuentas de origen y destino no pueden ser iguales', fr:'Les comptes source et destination ne peuvent pas être identiques'},
  'Cotação não disponível. Insira manualmente.': {pt:'Cotação não disponível. Insira manualmente.', en:'Quote not available. Enter manually.', es:'Cotización no disponible. Ingrese manualmente.', fr:'Cours non disponible. Saisissez manuellement.'},
  'Digite os 6 dígitos': {pt:'Digite os 6 dígitos', en:'Enter the 6 digits', es:'Ingrese los 6 dígitos', fr:'Saisissez les 6 chiffres'},
  'Endereço de e-mail inválido': {pt:'Endereço de e-mail inválido', en:'Invalid email address', es:'Dirección de correo inválida', fr:'Adresse e-mail invalide'},
  'Erro ao abrir snapshots da família:': {pt:'Erro ao abrir snapshots da família:', en:'Error opening family snapshots:', es:'Error al abrir instantáneas de la familia:', fr:'Erreur à l\'ouverture des instantanés de la famille :'},
  'Erro ao adicionar item:': {pt:'Erro ao adicionar item:', en:'Error adding item:', es:'Error al agregar artículo:', fr:'Erreur lors de l\'ajout de l\'article :'},
  'Erro ao adicionar:': {pt:'Erro ao adicionar:', en:'Error adding:', es:'Error al agregar:', fr:'Erreur lors de l\'ajout :'},
  'Erro ao alterar perfil:': {pt:'Erro ao alterar perfil:', en:'Error updating profile:', es:'Error al actualizar perfil:', fr:'Erreur lors de la mise à jour du profil :'},
  'Erro ao alterar senha:': {pt:'Erro ao alterar senha:', en:'Error changing password:', es:'Error al cambiar contraseña:', fr:'Erreur lors du changement de mot de passe :'},
  'Erro ao aprovar no banco:': {pt:'Erro ao aprovar no banco:', en:'Error approving in database:', es:'Error al aprobar en la base de datos:', fr:'Erreur lors de l\'approbation dans la base de données :'},
  'Erro ao aprovar:': {pt:'Erro ao aprovar:', en:'Error approving:', es:'Error al aprobar:', fr:'Erreur lors de l\'approbation :'},
  'Erro ao atualizar status:': {pt:'Erro ao atualizar status:', en:'Error updating status:', es:'Error al actualizar estado:', fr:'Erreur lors de la mise à jour du statut :'},
  'Erro ao atualizar transações:': {pt:'Erro ao atualizar transações:', en:'Error updating transactions:', es:'Error al actualizar transacciones:', fr:'Erreur lors de la mise à jour des transactions :'},
  'Erro ao baixar backup:': {pt:'Erro ao baixar backup:', en:'Error downloading backup:', es:'Error al descargar respaldo:', fr:'Erreur lors du téléchargement de la sauvegarde :'},
  'Erro ao buscar transações:': {pt:'Erro ao buscar transações:', en:'Error fetching transactions:', es:'Error al buscar transacciones:', fr:'Erreur lors de la récupération des transactions :'},
  'Erro ao buscar usuário:': {pt:'Erro ao buscar usuário:', en:'Error fetching user:', es:'Error al buscar usuario:', fr:'Erreur lors de la récupération de l\'utilisateur :'},
  'Erro ao carregar itens:': {pt:'Erro ao carregar itens:', en:'Error loading items:', es:'Error al cargar artículos:', fr:'Erreur lors du chargement des articles :'},
  'Erro ao carregar listas:': {pt:'Erro ao carregar listas:', en:'Error loading lists:', es:'Error al cargar listas:', fr:'Erreur lors du chargement des listes :'},
  'Erro ao carregar orçamentos:': {pt:'Erro ao carregar orçamentos:', en:'Error loading budgets:', es:'Error al cargar presupuestos:', fr:'Erreur lors du chargement des budgets :'},
  'Erro ao carregar transações:': {pt:'Erro ao carregar transações:', en:'Error loading transactions:', es:'Error al cargar transacciones:', fr:'Erreur lors du chargement des transactions :'},
  'Erro ao convidar:': {pt:'Erro ao convidar:', en:'Error inviting:', es:'Error al invitar:', fr:'Erreur lors de l\'invitation :'},
  'Erro ao criar IOF:': {pt:'Erro ao criar IOF:', en:'Error creating IOF:', es:'Error al crear IOF:', fr:'Erreur lors de la création de l\'IOF :'},
  'Erro ao criar backup:': {pt:'Erro ao criar backup:', en:'Error creating backup:', es:'Error al crear respaldo:', fr:'Erreur lors de la création de la sauvegarde :'},
  'Erro ao criar beneficiário:': {pt:'Erro ao criar beneficiário:', en:'Error creating payee:', es:'Error al crear beneficiario:', fr:'Erreur lors de la création du bénéficiaire :'},
  'Erro ao criar categoria Impostos:': {pt:'Erro ao criar categoria Impostos:', en:'Error creating Taxes category:', es:'Error al crear categoría Impuestos:', fr:'Erreur lors de la création de la catégorie Impôts :'},
  'Erro ao criar conta:': {pt:'Erro ao criar conta:', en:'Error creating account:', es:'Error al crear cuenta:', fr:'Erreur lors de la création du compte :'},
  'Erro ao criar estabelecimento:': {pt:'Erro ao criar estabelecimento:', en:'Error creating store:', es:'Error al crear establecimiento:', fr:'Erreur lors de la création de l\'établissement :'},
  'Erro ao criar família:': {pt:'Erro ao criar família:', en:'Error creating family:', es:'Error al crear familia:', fr:'Erreur lors de la création de la famille :'},
  'Erro ao criar lista:': {pt:'Erro ao criar lista:', en:'Error creating list:', es:'Error al crear lista:', fr:'Erreur lors de la création de la liste :'},
  'Erro ao criar programação:': {pt:'Erro ao criar programação:', en:'Error creating schedule:', es:'Error al crear programación:', fr:'Erreur lors de la création de la programmation :'},
  'Erro ao desativar conta:': {pt:'Erro ao desativar conta:', en:'Error deactivating account:', es:'Error al desactivar cuenta:', fr:'Erreur lors de la désactivation du compte :'},
  'Erro ao enviar:': {pt:'Erro ao enviar:', en:'Error sending:', es:'Error al enviar:', fr:'Erreur lors de l\'envoi :'},
  'Erro ao excluir programadas:': {pt:'Erro ao excluir programadas:', en:'Error deleting scheduled:', es:'Error al eliminar programadas:', fr:'Erreur lors de la suppression des programmées :'},
  'Erro ao excluir transações:': {pt:'Erro ao excluir transações:', en:'Error deleting transactions:', es:'Error al eliminar transacciones:', fr:'Erreur lors de la suppression des transactions :'},
  'Erro ao exportar:': {pt:'Erro ao exportar:', en:'Error exporting:', es:'Error al exportar:', fr:'Erreur lors de l\'exportation :'},
  'Erro ao gerar PDF:': {pt:'Erro ao gerar PDF:', en:'Error generating PDF:', es:'Error al generar PDF:', fr:'Erreur lors de la génération du PDF :'},
  'Erro ao ignorar ocorrência:': {pt:'Erro ao ignorar ocorrência:', en:'Error skipping occurrence:', es:'Error al ignorar ocurrencia:', fr:'Erreur lors du saut de l\'occurrence :'},
  'Erro ao limpar cache:': {pt:'Erro ao limpar cache:', en:'Error clearing cache:', es:'Error al limpiar caché:', fr:'Erreur lors du nettoyage du cache :'},
  'Erro ao limpar dados:': {pt:'Erro ao limpar dados:', en:'Error clearing data:', es:'Error al limpiar datos:', fr:'Erreur lors de l\'effacement des données :'},
  'Erro ao limpar:': {pt:'Erro ao limpar:', en:'Error clearing:', es:'Error al limpiar:', fr:'Erreur lors du nettoyage :'},
  'Erro ao mover destinos de transferência:': {pt:'Erro ao mover destinos de transferência:', en:'Error moving transfer destinations:', es:'Error al mover destinos de transferencia:', fr:'Erreur lors du déplacement des destinations de virement :'},
  'Erro ao mover programadas:': {pt:'Erro ao mover programadas:', en:'Error moving scheduled:', es:'Error al mover programadas:', fr:'Erreur lors du déplacement des programmées :'},
  'Erro ao mover transações:': {pt:'Erro ao mover transações:', en:'Error moving transactions:', es:'Error al mover transacciones:', fr:'Erreur lors du déplacement des transactions :'},
  'Erro ao preparar arquivo:': {pt:'Erro ao preparar arquivo:', en:'Error preparing file:', es:'Error al preparar archivo:', fr:'Erreur lors de la préparation du fichier :'},
  'Erro ao pré-validar:': {pt:'Erro ao pré-validar:', en:'Error pre-validating:', es:'Error al pre-validar:', fr:'Erreur lors de la pré-validation :'},
  'Erro ao remover anexo:': {pt:'Erro ao remover anexo:', en:'Error removing attachment:', es:'Error al eliminar adjunto:', fr:'Erreur lors de la suppression de la pièce jointe :'},
  'Erro ao restaurar:': {pt:'Erro ao restaurar:', en:'Error restoring:', es:'Error al restaurar:', fr:'Erreur lors de la restauration :'},
  'Erro ao salvar estabelecimento:': {pt:'Erro ao salvar estabelecimento:', en:'Error saving store:', es:'Error al guardar establecimiento:', fr:'Erreur lors de l\'enregistrement de l\'établissement :'},
  'Erro ao salvar perfil:': {pt:'Erro ao salvar perfil:', en:'Error saving profile:', es:'Error al guardar perfil:', fr:'Erreur lors de l\'enregistrement du profil :'},
  'Erro ao salvar vínculo:': {pt:'Erro ao salvar vínculo:', en:'Error saving link:', es:'Error al guardar vínculo:', fr:'Erreur lors de l\'enregistrement du lien :'},
  'Erro ao verificar programados:': {pt:'Erro ao verificar programados:', en:'Error checking scheduled:', es:'Error al verificar programados:', fr:'Erreur lors de la vérification des programmés :'},
  'Erro na IA:': {pt:'Erro na IA:', en:'AI error:', es:'Error en IA:', fr:'Erreur IA :'},
  'Erro na análise:': {pt:'Erro na análise:', en:'Analysis error:', es:'Error en el análisis:', fr:'Erreur d\'analyse :'},
  'Erro na leitura com IA:': {pt:'Erro na leitura com IA:', en:'AI reading error:', es:'Error en lectura con IA:', fr:'Erreur de lecture IA :'},
  'Erro na leitura:': {pt:'Erro na leitura:', en:'Reading error:', es:'Error de lectura:', fr:'Erreur de lecture :'},
  'Erro no import:': {pt:'Erro no import:', en:'Import error:', es:'Error en importación:', fr:'Erreur d\'importation :'},
  'Erro no upload:': {pt:'Erro no upload:', en:'Upload error:', es:'Error al subir:', fr:'Erreur de téléversement :'},
  'Erro:': {pt:'Erro:', en:'Error:', es:'Error:', fr:'Erreur :'},
  'Essa ocorrência já está sendo processada em outra execução.': {pt:'Essa ocorrência já está sendo processada em outra execução.', en:'This occurrence is already being processed in another run.', es:'Esta ocurrencia ya está siendo procesada en otra ejecución.', fr:'Cette occurrence est déjà en cours de traitement dans une autre exécution.'},
  'Essa ocorrência já foi registrada anteriormente.': {pt:'Essa ocorrência já foi registrada anteriormente.', en:'This occurrence has already been registered.', es:'Esta ocurrencia ya fue registrada anteriormente.', fr:'Cette occurrence a déjà été enregistrée.'},
  'Estabelecimento excluído': {pt:'Estabelecimento excluído', en:'Store deleted', es:'Establecimiento eliminado', fr:'Établissement supprimé'},
  'Exclusão cancelada — texto incorreto': {pt:'Exclusão cancelada — texto incorreto', en:'Deletion cancelled — incorrect text', es:'Eliminación cancelada — texto incorrecto', fr:'Suppression annulée — texte incorrect'},
  'Execute uma análise primeiro': {pt:'Execute uma análise primeiro', en:'Run an analysis first', es:'Ejecute un análisis primero', fr:'Effectuez d\'abord une analyse'},
  'Falha no teste:': {pt:'Falha no teste:', en:'Test failed:', es:'Error en la prueba:', fr:'Échec du test :'},
  'Família não identificada': {pt:'Família não identificada', en:'Family not identified', es:'Familia no identificada', fr:'Famille non identifiée'},
  'Família não informada para o backup.': {pt:'Família não informada para o backup.', en:'Family not specified for backup.', es:'Familia no especificada para el respaldo.', fr:'Famille non spécifiée pour la sauvegarde.'},
  'Família removida': {pt:'Família removida', en:'Family removed', es:'Familia eliminada', fr:'Famille supprimée'},
  'Formato inválido. Use PDF, JPG, PNG ou WebP': {pt:'Formato inválido. Use PDF, JPG, PNG ou WebP', en:'Invalid format. Use PDF, JPG, PNG or WebP', es:'Formato inválido. Use PDF, JPG, PNG o WebP', fr:'Format invalide. Utilisez PDF, JPG, PNG ou WebP'},
  'Formato não suportado. Use imagem ou PDF.': {pt:'Formato não suportado. Use imagem ou PDF.', en:'Unsupported format. Use image or PDF.', es:'Formato no compatible. Use imagen o PDF.', fr:'Format non pris en charge. Utilisez une image ou un PDF.'},
  'ID da transação ausente': {pt:'ID da transação ausente', en:'Transaction ID missing', es:'ID de transacción faltante', fr:'ID de transaction manquant'},
  'Imagem muito grande (máx 2 MB)': {pt:'Imagem muito grande (máx 2 MB)', en:'Image too large (max 2 MB)', es:'Imagen demasiado grande (máx. 2 MB)', fr:'Image trop grande (max. 2 Mo)'},
  'Importação concluída!': {pt:'Importação concluída!', en:'Import complete!', es:'¡Importación completada!', fr:'Importation terminée !'},
  'Informe a data de início': {pt:'Informe a data de início', en:'Enter the start date', es:'Ingrese la fecha de inicio', fr:'Saisissez la date de début'},
  'Informe a descrição': {pt:'Informe a descrição', en:'Enter the description', es:'Ingrese la descripción', fr:'Saisissez la description'},
  'Informe o destinatário': {pt:'Informe o destinatário', en:'Enter the recipient', es:'Ingrese el destinatario', fr:'Saisissez le destinataire'},
  'Informe o nome da família': {pt:'Informe o nome da família', en:'Enter the family name', es:'Ingrese el nombre de la familia', fr:'Saisissez le nom de la famille'},
  'Informe o nome da lista': {pt:'Informe o nome da lista', en:'Enter the list name', es:'Ingrese el nombre de la lista', fr:'Saisissez le nom de la liste'},
  'Informe o nome do item': {pt:'Informe o nome do item', en:'Enter the item name', es:'Ingrese el nombre del artículo', fr:'Saisissez le nom de l\'article'},
  'Informe o nome do novo beneficiário': {pt:'Informe o nome do novo beneficiário', en:'Enter the new payee name', es:'Ingrese el nombre del nuevo beneficiario', fr:'Saisissez le nom du nouveau bénéficiaire'},
  'Informe o valor limite': {pt:'Informe o valor limite', en:'Enter the limit amount', es:'Ingrese el valor límite', fr:'Saisissez le montant limite'},
  'Informe um e-mail válido': {pt:'Informe um e-mail válido', en:'Enter a valid email', es:'Ingrese un correo válido', fr:'Saisissez un e-mail valide'},
  'Informe uma URL ou selecione um arquivo': {pt:'Informe uma URL ou selecione um arquivo', en:'Enter a URL or select a file', es:'Ingrese una URL o seleccione un archivo', fr:'Saisissez une URL ou sélectionnez un fichier'},
  'Item adicionado!': {pt:'Item adicionado!', en:'Item added!', es:'¡Artículo agregado!', fr:'Article ajouté !'},
  'Item excluído': {pt:'Item excluído', en:'Item deleted', es:'Artículo eliminado', fr:'Article supprimé'},
  'Leia o recibo com IA primeiro.': {pt:'Leia o recibo com IA primeiro.', en:'Read the receipt with AI first.', es:'Lea el recibo con IA primero.', fr:'Lisez d\'abord le reçu avec l\'IA.'},
  'Limite de requisições atingido.': {pt:'Limite de requisições atingido.', en:'Request limit reached.', es:'Límite de solicitudes alcanzado.', fr:'Limite de requêtes atteinte.'},
  'Limite de requisições atingido. Aguarde alguns segundos.': {pt:'Limite de requisições atingido. Aguarde alguns segundos.', en:'Request limit reached. Please wait a few seconds.', es:'Límite de solicitudes alcanzado. Espere unos segundos.', fr:'Limite de requêtes atteinte. Veuillez patienter quelques secondes.'},
  'Limite de requisições atingido. Aguarde.': {pt:'Limite de requisições atingido. Aguarde.', en:'Request limit reached. Please wait.', es:'Límite de solicitudes alcanzado. Espere.', fr:'Limite de requêtes atteinte. Veuillez patienter.'},
  'Limite de requisições. Aguarde.': {pt:'Limite de requisições. Aguarde.', en:'Request limit. Please wait.', es:'Límite de solicitudes. Espere.', fr:'Limite de requêtes. Veuillez patienter.'},
  'Limpeza parcial — veja detalhes': {pt:'Limpeza parcial — veja detalhes', en:'Partial cleanup — see details', es:'Limpieza parcial — ver detalles', fr:'Nettoyage partiel — voir les détails'},
  'Lista criada!': {pt:'Lista criada!', en:'List created!', es:'¡Lista creada!', fr:'Liste créée !'},
  'Lista de Mercado não está ativa. Ative em Administração → Famílias.': {pt:'Lista de Mercado não está ativa. Ative em Administração → Famílias.', en:'Grocery List is not active. Enable it in Administration → Families.', es:'La Lista de Mercado no está activa. Actívela en Administración → Familias.', fr:'La liste de courses n\'est pas active. Activez-la dans Administration → Familles.'},
  'Lista removida': {pt:'Lista removida', en:'List removed', es:'Lista eliminada', fr:'Liste supprimée'},
  'Logotipo atualizado': {pt:'Logotipo atualizado', en:'Logo updated', es:'Logotipo actualizado', fr:'Logo mis à jour'},
  'Logotipo restaurado': {pt:'Logotipo restaurado', en:'Logo restored', es:'Logotipo restaurado', fr:'Logo restauré'},
  'Masterpin alterado com sucesso! 🔐': {pt:'Masterpin alterado com sucesso! 🔐', en:'Masterpin changed successfully! 🔐', es:'¡Masterpin cambiado con éxito! 🔐', fr:'Masterpin modifié avec succès ! 🔐'},
  'Menu atualizado ✓': {pt:'Menu atualizado ✓', en:'Menu updated ✓', es:'Menú actualizado ✓', fr:'Menu mis à jour ✓'},
  'Menu restaurado ✓': {pt:'Menu restaurado ✓', en:'Menu restored ✓', es:'Menú restaurado ✓', fr:'Menu restauré ✓'},
  'Modal de e-mail não encontrado': {pt:'Modal de e-mail não encontrado', en:'Email modal not found', es:'Modal de correo no encontrado', fr:'Modal d\'e-mail introuvable'},
  'Modal de programação não encontrado.': {pt:'Modal de programação não encontrado.', en:'Schedule modal not found.', es:'Modal de programación no encontrado.', fr:'Modal de programmation introuvable.'},
  'Motor de programados não disponível no momento.': {pt:'Motor de programados não disponível no momento.', en:'Scheduled transaction engine not available at the moment.', es:'Motor de programados no disponible en este momento.', fr:'Le moteur de transactions programmées n\'est pas disponible pour le moment.'},
  'Nenhum dado para exportar': {pt:'Nenhum dado para exportar', en:'No data to export', es:'No hay datos para exportar', fr:'Aucune donnée à exporter'},
  'Nenhum grupo selecionado para exclusão': {pt:'Nenhum grupo selecionado para exclusão', en:'No group selected for deletion', es:'Ningún grupo seleccionado para eliminar', fr:'Aucun groupe sélectionné pour la suppression'},
  'Nenhum item selecionado': {pt:'Nenhum item selecionado', en:'No item selected', es:'Ningún artículo seleccionado', fr:'Aucun article sélectionné'},
  'Nenhum preço novo foi salvo. Verifique o mapeamento dos itens.': {pt:'Nenhum preço novo foi salvo. Verifique o mapeamento dos itens.', en:'No new price was saved. Check the item mapping.', es:'No se guardó ningún precio nuevo. Verifique el mapeo de artículos.', fr:'Aucun nouveau prix n\'a été enregistré. Vérifiez le mappage des articles.'},
  'Nenhuma lista aberta.': {pt:'Nenhuma lista aberta.', en:'No list open.', es:'Ninguna lista abierta.', fr:'Aucune liste ouverte.'},
  'Nenhuma moeda estrangeira cadastrada.': {pt:'Nenhuma moeda estrangeira cadastrada.', en:'No foreign currency registered.', es:'Ninguna moneda extranjera registrada.', fr:'Aucune devise étrangère enregistrée.'},
  'Nenhuma transação pendente para registrar': {pt:'Nenhuma transação pendente para registrar', en:'No pending transaction to register', es:'Ninguna transacción pendiente para registrar', fr:'Aucune transaction en attente à enregistrer'},
  'Nome incorreto — operação cancelada': {pt:'Nome incorreto — operação cancelada', en:'Incorrect name — operation cancelled', es:'Nombre incorrecto — operación cancelada', fr:'Nom incorrect — opération annulée'},
  'Não foi possível acessar a área de transferência. Cole manualmente no campo.': {pt:'Não foi possível acessar a área de transferência. Cole manualmente no campo.', en:'Could not access clipboard. Paste manually in the field.', es:'No se pudo acceder al portapapeles. Pegue manualmente en el campo.', fr:'Impossible d\'accéder au presse-papiers. Collez manuellement dans le champ.'},
  'Não foi possível acessar o clipboard. Cole manualmente.': {pt:'Não foi possível acessar o clipboard. Cole manualmente.', en:'Could not access clipboard. Paste manually.', es:'No se pudo acceder al portapapeles. Pegue manualmente.', fr:'Impossible d\'accéder au presse-papiers. Collez manuellement.'},
  'Não foi possível determinar a família ativa para o backup.': {pt:'Não foi possível determinar a família ativa para o backup.', en:'Could not determine the active family for backup.', es:'No se pudo determinar la familia activa para el respaldo.', fr:'Impossible de déterminer la famille active pour la sauvegarde.'},
  'Não foi possível determinar a família ativa.': {pt:'Não foi possível determinar a família ativa.', en:'Could not determine the active family.', es:'No se pudo determinar la familia activa.', fr:'Impossible de déterminer la famille active.'},
  'Não foi possível obter a URL pública do arquivo': {pt:'Não foi possível obter a URL pública do arquivo', en:'Could not get the public URL of the file', es:'No se pudo obtener la URL pública del archivo', fr:'Impossible d\'obtenir l\'URL publique du fichier'},
  'Ocorrência ignorada. Próximas datas não são afetadas.': {pt:'Ocorrência ignorada. Próximas datas não são afetadas.', en:'Occurrence skipped. Next dates are not affected.', es:'Ocurrencia ignorada. Las próximas fechas no se ven afectadas.', fr:'Occurrence ignorée. Les prochaines dates ne sont pas affectées.'},
  'Orçamento excluído': {pt:'Orçamento excluído', en:'Budget deleted', es:'Presupuesto eliminado', fr:'Budget supprimé'},
  'Preencha nome e e-mail': {pt:'Preencha nome e e-mail', en:'Fill in name and email', es:'Complete nombre y correo', fr:'Remplissez le nom et l\'e-mail'},
  'Preencha todos os campos': {pt:'Preencha todos os campos', en:'Fill in all fields', es:'Complete todos los campos', fr:'Remplissez tous les champs'},
  'Preencha todos os campos primeiro': {pt:'Preencha todos os campos primeiro', en:'Fill in all fields first', es:'Complete todos los campos primero', fr:'Remplissez d\'abord tous les champs'},
  'Preferências do dashboard salvas!': {pt:'Preferências do dashboard salvas!', en:'Dashboard preferences saved!', es:'¡Preferencias del panel guardadas!', fr:'Préférences du tableau de bord enregistrées !'},
  'Preço inválido': {pt:'Preço inválido', en:'Invalid price', es:'Precio inválido', fr:'Prix invalide'},
  'Programação não encontrada': {pt:'Programação não encontrada', en:'Schedule not found', es:'Programación no encontrada', fr:'Programmation introuvable'},
  'Recurso de preços não está ativo para esta família.': {pt:'Recurso de preços não está ativo para esta família.', en:'Prices feature is not active for this family.', es:'La función de precios no está activa para esta familia.', fr:'La fonctionnalité de prix n\'est pas active pour cette famille.'},
  'Registro removido': {pt:'Registro removido', en:'Record removed', es:'Registro eliminado', fr:'Enregistrement supprimé'},
  'Removido': {pt:'Removido', en:'Removed', es:'Eliminado', fr:'Supprimé'},
  'Resposta inválida da IA': {pt:'Resposta inválida da IA', en:'Invalid AI response', es:'Respuesta inválida de la IA', fr:'Réponse IA invalide'},
  'Resposta inválida da IA:': {pt:'Resposta inválida da IA:', en:'Invalid AI response:', es:'Respuesta inválida de la IA:', fr:'Réponse IA invalide :'},
  'Resposta inválida:': {pt:'Resposta inválida:', en:'Invalid response:', es:'Respuesta inválida:', fr:'Réponse invalide :'},
  'SQL copiado!': {pt:'SQL copiado!', en:'SQL copied!', es:'¡SQL copiado!', fr:'SQL copié !'},
  'Selecione a conta destino da transferência': {pt:'Selecione a conta destino da transferência', en:'Select the transfer destination account', es:'Seleccione la cuenta destino de la transferencia', fr:'Sélectionnez le compte de destination du virement'},
  'Selecione o ano': {pt:'Selecione o ano', en:'Select the year', es:'Seleccione el año', fr:'Sélectionnez l\'année'},
  'Selecione o beneficiário destino': {pt:'Selecione o beneficiário destino', en:'Select the destination payee', es:'Seleccione el beneficiario destino', fr:'Sélectionnez le bénéficiaire de destination'},
  'Selecione o mês': {pt:'Selecione o mês', en:'Select the month', es:'Seleccione el mes', fr:'Sélectionnez le mois'},
  'Selecione o texto acima e copie': {pt:'Selecione o texto acima e copie', en:'Select the text above and copy', es:'Seleccione el texto de arriba y copie', fr:'Sélectionnez le texte ci-dessus et copiez'},
  'Selecione um arquivo primeiro.': {pt:'Selecione um arquivo primeiro.', en:'Select a file first.', es:'Seleccione un archivo primero.', fr:'Sélectionnez d\'abord un fichier.'},
  'Selecione um usuário': {pt:'Selecione um usuário', en:'Select a user', es:'Seleccione un usuario', fr:'Sélectionnez un utilisateur'},
  'Selecione uma categoria': {pt:'Selecione uma categoria', en:'Select a category', es:'Seleccione una categoría', fr:'Sélectionnez une catégorie'},
  'Selecione uma imagem': {pt:'Selecione uma imagem', en:'Select an image', es:'Seleccione una imagen', fr:'Sélectionnez une image'},
  'Selecione uma imagem (JPG/PNG) ou PDF.': {pt:'Selecione uma imagem (JPG/PNG) ou PDF.', en:'Select an image (JPG/PNG) or PDF.', es:'Seleccione una imagen (JPG/PNG) o PDF.', fr:'Sélectionnez une image (JPG/PNG) ou un PDF.'},
  'Selecione uma imagem ou PDF primeiro': {pt:'Selecione uma imagem ou PDF primeiro', en:'Select an image or PDF first', es:'Seleccione una imagen o PDF primero', fr:'Sélectionnez d\'abord une image ou un PDF'},
  'Selecione uma lista': {pt:'Selecione uma lista', en:'Select a list', es:'Seleccione una lista', fr:'Sélectionnez une liste'},
  'Sem Service Role Key configurada. Vá em Configurações → Service Role Key.': {pt:'Sem Service Role Key configurada. Vá em Configurações → Service Role Key.', en:'No Service Role Key configured. Go to Settings → Service Role Key.', es:'Sin Service Role Key configurada. Vaya a Configuración → Service Role Key.', fr:'Aucune Service Role Key configurée. Allez dans Paramètres → Service Role Key.'},
  'Sem conexão': {pt:'Sem conexão', en:'No connection', es:'Sin conexión', fr:'Pas de connexion'},
  'Sem conexão com o banco': {pt:'Sem conexão com o banco', en:'No database connection', es:'Sin conexión con la base de datos', fr:'Pas de connexion à la base de données'},
  'Sem permissão para editar esta família': {pt:'Sem permissão para editar esta família', en:'No permission to edit this family', es:'Sin permiso para editar esta familia', fr:'Pas d\'autorisation pour modifier cette famille'},
  'Senha deve ter pelo menos 8 caracteres': {pt:'Senha deve ter pelo menos 8 caracteres', en:'Password must be at least 8 characters', es:'La contraseña debe tener al menos 8 caracteres', fr:'Le mot de passe doit comporter au moins 8 caractères'},
  'Service Role Key removida': {pt:'Service Role Key removida', en:'Service Role Key removed', es:'Service Role Key eliminada', fr:'Service Role Key supprimée'},
  'Sessão expirada. Solicite um novo link de recuperação.': {pt:'Sessão expirada. Solicite um novo link de recuperação.', en:'Session expired. Request a new recovery link.', es:'Sesión expirada. Solicite un nuevo enlace de recuperación.', fr:'Session expirée. Demandez un nouveau lien de récupération.'},
  'Supabase client não inicializado.': {pt:'Supabase client não inicializado.', en:'Supabase client not initialized.', es:'Cliente Supabase no inicializado.', fr:'Client Supabase non initialisé.'},
  'Supabase não conectado.': {pt:'Supabase não conectado.', en:'Supabase not connected.', es:'Supabase no conectado.', fr:'Supabase non connecté.'},
  'Supabase não inicializado': {pt:'Supabase não inicializado', en:'Supabase not initialized', es:'Supabase no inicializado', fr:'Supabase non initialisé'},
  'Suporte a PDF não disponível. Use uma imagem.': {pt:'Suporte a PDF não disponível. Use uma imagem.', en:'PDF support not available. Use an image.', es:'Soporte para PDF no disponible. Use una imagen.', fr:'Prise en charge PDF non disponible. Utilisez une image.'},
  'Tabela app_backups não existe. Execute a migration primeiro.': {pt:'Tabela app_backups não existe. Execute a migration primeiro.', en:'Table app_backups does not exist. Run the migration first.', es:'La tabla app_backups no existe. Ejecute la migración primero.', fr:'La table app_backups n\'existe pas. Exécutez d\'abord la migration.'},
  'Taxa não encontrada': {pt:'Taxa não encontrada', en:'Rate not found', es:'Tasa no encontrada', fr:'Taux introuvable'},
  'Taxa não encontrada na resposta': {pt:'Taxa não encontrada na resposta', en:'Rate not found in response', es:'Tasa no encontrada en la respuesta', fr:'Taux introuvable dans la réponse'},
  'Tipo de arquivo não suportado para IA': {pt:'Tipo de arquivo não suportado para IA', en:'File type not supported for AI', es:'Tipo de archivo no compatible con IA', fr:'Type de fichier non pris en charge pour l\'IA'},
  'Transação registrada!': {pt:'Transação registrada!', en:'Transaction registered!', es:'¡Transacción registrada!', fr:'Transaction enregistrée !'},
  'Upload falhou:': {pt:'Upload falhou:', en:'Upload failed:', es:'Error al subir:', fr:'Échec du téléversement :'},
  'Usuário já está aprovado.': {pt:'Usuário já está aprovado.', en:'User is already approved.', es:'El usuario ya está aprobado.', fr:'L\'utilisateur est déjà approuvé.'},
  'Usuário não encontrado no Auth:': {pt:'Usuário não encontrado no Auth:', en:'User not found in Auth:', es:'Usuario no encontrado en Auth:', fr:'Utilisateur introuvable dans Auth :'},
  'Usuário não encontrado ou sem permissão': {pt:'Usuário não encontrado ou sem permissão', en:'User not found or no permission', es:'Usuario no encontrado o sin permiso', fr:'Utilisateur introuvable ou sans permission'},
  'Usuário não encontrado.': {pt:'Usuário não encontrado.', en:'User not found.', es:'Usuario no encontrado.', fr:'Utilisateur introuvable.'},
  'Visibilidade restaurada ao padrão ✓': {pt:'Visibilidade restaurada ao padrão ✓', en:'Visibility restored to default ✓', es:'Visibilidad restaurada al predeterminado ✓', fr:'Visibilité restaurée par défaut ✓'},
  'Você não pode excluir sua única família. Crie outra primeiro.': {pt:'Você não pode excluir sua única família. Crie outra primeiro.', en:'You cannot delete your only family. Create another one first.', es:'No puede eliminar su única familia. Cree otra primero.', fr:'Vous ne pouvez pas supprimer votre seule famille. Créez-en une autre d\'abord.'},
  'Você não é owner de nenhuma família': {pt:'Você não é owner de nenhuma família', en:'You are not the owner of any family', es:'No es propietario de ninguna familia', fr:'Vous n\'êtes propriétaire d\'aucune famille'},
  'Vínculo salvo!': {pt:'Vínculo salvo!', en:'Link saved!', es:'¡Vínculo guardado!', fr:'Lien enregistré !'},
  'Academia': {pt:'Academia', en:'Gym', es:'Gimnasio', fr:'Salle de sport'},
  'American Express': {pt:'American Express', en:'American Express', es:'American Express', fr:'American Express'},
  'Assinaturas': {pt:'Assinaturas', en:'Subscriptions', es:'Suscripciones', fr:'Abonnements'},
  'Assunto': {pt:'Assunto', en:'Subject', es:'Asunto', fr:'Objet'},
  'Açougue': {pt:'Açougue', en:'Butcher', es:'Carnicería', fr:'Boucherie'},
  'Baixar CSV': {pt:'Baixar CSV', en:'Download CSV', es:'Descargar CSV', fr:'Télécharger CSV'},
  'Baixar PDF': {pt:'Baixar PDF', en:'Download PDF', es:'Descargar PDF', fr:'Télécharger PDF'},
  'Banco': {pt:'Banco', en:'Bank', es:'Banco', fr:'Banque'},
  'Banco Inter': {pt:'Banco Inter', en:'Banco Inter', es:'Banco Inter', fr:'Banco Inter'},
  'Banco do Brasil': {pt:'Banco do Brasil', en:'Banco do Brasil', es:'Banco do Brasil', fr:'Banco do Brasil'},
  'Bebidas': {pt:'Bebidas', en:'Beverages', es:'Bebidas', fr:'Boissons'},
  'Bem-estar': {pt:'Bem-estar', en:'Well-being', es:'Bienestar', fr:'Bien-être'},
  'Beneficiário / Fonte': {pt:'Beneficiário / Fonte', en:'Payee / Source', es:'Beneficiario / Fuente', fr:'Bénéficiaire / Source'},
  'Bicicleta': {pt:'Bicicleta', en:'Bicycle', es:'Bicicleta', fr:'Vélo'},
  'Buscar descricao...': {pt:'Buscar descricao...', en:'Search description...', es:'Buscar descripción...', fr:'Rechercher description...'},
  'Buscar estabelecimento…': {pt:'Buscar estabelecimento…', en:'Search store…', es:'Buscar establecimiento…', fr:'Rechercher établissement…'},
  'Buscar no catálogo de preços': {pt:'Buscar no catálogo de preços', en:'Search price catalog', es:'Buscar en el catálogo de precios', fr:'Rechercher dans le catalogue de prix'},
  'Buscar ou criar estabelecimento…': {pt:'Buscar ou criar estabelecimento…', en:'Search or create store…', es:'Buscar o crear establecimiento…', fr:'Rechercher ou créer un établissement…'},
  'Buscar ou criar...': {pt:'Buscar ou criar...', en:'Search or create...', es:'Buscar o crear...', fr:'Rechercher ou créer...'},
  'Buscar transação…': {pt:'Buscar transação…', en:'Search transaction…', es:'Buscar transacción…', fr:'Rechercher transaction…'},
  'Buscar...': {pt:'Buscar...', en:'Search...', es:'Buscar...', fr:'Rechercher...'},
  'Cadastrar novo estabelecimento': {pt:'Cadastrar novo estabelecimento', en:'Register new store', es:'Registrar nuevo establecimiento', fr:'Enregistrer un nouvel établissement'},
  'Calendário': {pt:'Calendário', en:'Calendar', es:'Calendario', fr:'Calendrier'},
  'Carregando listas…': {pt:'Carregando listas…', en:'Loading lists…', es:'Cargando listas…', fr:'Chargement des listes…'},
  'Carro': {pt:'Carro', en:'Car', es:'Coche', fr:'Voiture'},
  'Cinema': {pt:'Cinema', en:'Cinema', es:'Cine', fr:'Cinéma'},
  'Clique para alterar foto': {pt:'Clique para alterar foto', en:'Click to change photo', es:'Haga clic para cambiar foto', fr:'Cliquez pour changer la photo'},
  'Combustível': {pt:'Combustível', en:'Fuel', es:'Combustible', fr:'Carburant'},
  'Compras': {pt:'Compras', en:'Shopping', es:'Compras', fr:'Achats'},
  'Condomínio': {pt:'Condomínio', en:'Condo fee', es:'Condominio', fr:'Charges de copropriété'},
  'Confeitaria': {pt:'Confeitaria', en:'Bakery', es:'Pastelería', fr:'Pâtisserie'},
  'Configurar EmailJS': {pt:'Configurar EmailJS', en:'Configure EmailJS', es:'Configurar EmailJS', fr:'Configurer EmailJS'},
  'Confirmar Senha': {pt:'Confirmar Senha', en:'Confirm Password', es:'Confirmar contraseña', fr:'Confirmer le mot de passe'},
  'Construção': {pt:'Construção', en:'Construction', es:'Construcción', fr:'Construction'},
  'Consulta': {pt:'Consulta', en:'Medical visit', es:'Consulta', fr:'Consultation'},
  'Convites': {pt:'Convites', en:'Invitations', es:'Invitaciones', fr:'Invitations'},
  'Criar um novo beneficiário para receber os registros': {pt:'Criar um novo beneficiário para receber os registros', en:'Create a new payee to receive the records', es:'Crear un nuevo beneficiario para recibir los registros', fr:'Créer un nouveau bénéficiaire pour recevoir les enregistrements'},
  'Data *': {pt:'Data *', en:'Date *', es:'Fecha *', fr:'Date *'},
  'Data da Compra': {pt:'Data da Compra', en:'Purchase Date', es:'Fecha de compra', fr:'Date d\'achat'},
  'Data da Compra *': {pt:'Data da Compra *', en:'Purchase Date *', es:'Fecha de compra *', fr:'Date d\'achat *'},
  'Data do ajuste': {pt:'Data do ajuste', en:'Adjustment date', es:'Fecha de ajuste', fr:'Date d\'ajustement'},
  'Data final': {pt:'Data final', en:'End date', es:'Fecha final', fr:'Date de fin'},
  'Data inicial': {pt:'Data inicial', en:'Start date', es:'Fecha inicial', fr:'Date initiale'},
  'Data real *': {pt:'Data real *', en:'Actual date *', es:'Fecha real *', fr:'Date réelle *'},
  'Deixe em branco para manter': {pt:'Deixe em branco para manter', en:'Leave blank to keep', es:'Deje en blanco para mantener', fr:'Laissez vide pour conserver'},
  'Dentista': {pt:'Dentista', en:'Dentist', es:'Dentista', fr:'Dentiste'},
  'Descrição *': {pt:'Descrição *', en:'Description *', es:'Descripción *', fr:'Description *'},
  'Descrição / Marca': {pt:'Descrição / Marca', en:'Description / Brand', es:'Descripción / Marca', fr:'Description / Marque'},
  'Destinatário': {pt:'Destinatário', en:'Recipient', es:'Destinatario', fr:'Destinataire'},
  'Dia de vencimento': {pt:'Dia de vencimento', en:'Due day', es:'Día de vencimiento', fr:'Jour d\'échéance'},
  'Digite o nome do item…': {pt:'Digite o nome do item…', en:'Enter item name…', es:'Ingrese el nombre del artículo…', fr:'Saisissez le nom de l\'article…'},
  'Digite para buscar ou criar...': {pt:'Digite para buscar ou criar...', en:'Type to search or create...', es:'Escriba para buscar o crear...', fr:'Tapez pour rechercher ou créer...'},
  'Diners Club': {pt:'Diners Club', en:'Diners Club', es:'Diners Club', fr:'Diners Club'},
  'Dispensar': {pt:'Dispensar', en:'Dismiss', es:'Descartar', fr:'Ignorer'},
  'Doações': {pt:'Doações', en:'Donations', es:'Donaciones', fr:'Dons'},
  'Duplicar': {pt:'Duplicar', en:'Duplicate', es:'Duplicar', fr:'Dupliquer'},
  'Educação': {pt:'Educação', en:'Education', es:'Educación', fr:'Éducation'},
  'Emoji': {pt:'Emoji', en:'Emoji', es:'Emoji', fr:'Emoji'},
  'Endereço (rua, número)': {pt:'Endereço (rua, número)', en:'Address (street, number)', es:'Dirección (calle, número)', fr:'Adresse (rue, numéro)'},
  'Energia': {pt:'Energia', en:'Energy', es:'Energía', fr:'Énergie'},
  'Entretenimento': {pt:'Entretenimento', en:'Entertainment', es:'Entretenimiento', fr:'Divertissement'},
  'Enviar por E-mail': {pt:'Enviar por E-mail', en:'Send by Email', es:'Enviar por correo', fr:'Envoyer par e-mail'},
  'Enviar por e-mail': {pt:'Enviar por e-mail', en:'Send by email', es:'Enviar por correo', fr:'Envoyer par e-mail'},
  'Erros': {pt:'Erros', en:'Errors', es:'Errores', fr:'Erreurs'},
  'Escritório': {pt:'Escritório', en:'Office', es:'Oficina', fr:'Bureau'},
  'Esporte': {pt:'Esporte', en:'Sport', es:'Deporte', fr:'Sport'},
  'Estacionamento': {pt:'Estacionamento', en:'Parking', es:'Estacionamiento', fr:'Stationnement'},
  'Filhos': {pt:'Filhos', en:'Children', es:'Hijos', fr:'Enfants'},
  'Filtrar por membro': {pt:'Filtrar por membro', en:'Filter by member', es:'Filtrar por miembro', fr:'Filtrer par membre'},
  'Fonte Pagadora': {pt:'Fonte Pagadora', en:'Payer', es:'Fuente pagadora', fr:'Source de paiement'},
  'Férias': {pt:'Férias', en:'Vacation', es:'Vacaciones', fr:'Vacances'},
  'Games': {pt:'Games', en:'Games', es:'Juegos', fr:'Jeux'},
  'Gastos': {pt:'Gastos', en:'Expenses', es:'Gastos', fr:'Dépenses'},
  'Gerenciar grupos': {pt:'Gerenciar grupos', en:'Manage groups', es:'Gestionar grupos', fr:'Gérer les groupes'},
  'Gerenciar vínculos entre estabelecimentos e beneficiários': {pt:'Gerenciar vínculos entre estabelecimentos e beneficiários', en:'Manage store-payee links', es:'Gestionar vínculos entre establecimientos y beneficiarios', fr:'Gérer les liens établissements-bénéficiaires'},
  'Governo': {pt:'Governo', en:'Government', es:'Gobierno', fr:'Gouvernement'},
  'Higiene Casa': {pt:'Higiene Casa', en:'Home hygiene', es:'Higiene del hogar', fr:'Hygiène maison'},
  'Higiene Pessoal': {pt:'Higiene Pessoal', en:'Personal hygiene', es:'Higiene personal', fr:'Hygiène personnelle'},
  'Hospital': {pt:'Hospital', en:'Hospital', es:'Hospital', fr:'Hôpital'},
  'Idioma / Language': {pt:'Idioma / Language', en:'Language', es:'Idioma', fr:'Langue'},
  'Impostos': {pt:'Impostos', en:'Taxes', es:'Impuestos', fr:'Impôts'},
  'Imprimir': {pt:'Imprimir', en:'Print', es:'Imprimir', fr:'Imprimer'},
  'Indefinido': {pt:'Indefinido', en:'Undefined', es:'Indefinido', fr:'Indéfini'},
  'Internacional': {pt:'Internacional', en:'International', es:'Internacional', fr:'International'},
  'Intervalo livre': {pt:'Intervalo livre', en:'Custom interval', es:'Intervalo libre', fr:'Intervalle libre'},
  'Jardim': {pt:'Jardim', en:'Garden', es:'Jardín', fr:'Jardin'},
  'Jogos': {pt:'Jogos', en:'Games', es:'Juegos', fr:'Jeux'},
  'Lembrar meu e-mail e senha': {pt:'Salvar meu usuário', en:'Save my username', es:'Guardar mi usuario', fr:'Enregistrer mon utilisateur'},
  'Limpar filtro': {pt:'Limpar filtro', en:'Clear filter', es:'Limpiar filtro', fr:'Effacer le filtre'},
  'Limpeza': {pt:'Limpeza', en:'Cleaning', es:'Limpieza', fr:'Nettoyage'},
  'Lista': {pt:'Lista', en:'List', es:'Lista', fr:'Liste'},
  'Lista plana': {pt:'Lista plana', en:'Flat list', es:'Lista plana', fr:'Liste plate'},
  'Livros': {pt:'Livros', en:'Books', es:'Libros', fr:'Livres'},
  'Manutenção': {pt:'Manutenção', en:'Maintenance', es:'Mantenimiento', fr:'Maintenance'},
  'Manutenção Veículo': {pt:'Manutenção Veículo', en:'Vehicle maintenance', es:'Mantenimiento de vehículo', fr:'Entretien véhicule'},
  'Mapear para →': {pt:'Mapear para →', en:'Map to →', es:'Mapear a →', fr:'Mapper vers →'},
  'Marca, variante, detalhes…': {pt:'Marca, variante, detalhes…', en:'Brand, variant, details…', es:'Marca, variante, detalles…', fr:'Marque, variante, détails…'},
  'Marcador': {pt:'Marcador', en:'Bookmark', es:'Marcador', fr:'Signet'},
  'Marmita': {pt:'Marmita', en:'Lunchbox', es:'Fiambrera', fr:'Gamelle'},
  'Melhor dia de compra': {pt:'Melhor dia de compra', en:'Best purchase day', es:'Mejor día de compra', fr:'Meilleur jour d\'achat'},
  'Memo / Observação': {pt:'Memo / Observação', en:'Memo / Note', es:'Memo / Observación', fr:'Mémo / Observation'},
  'Memo, notas...': {pt:'Memo, notas...', en:'Memo, notes...', es:'Memo, notas...', fr:'Mémo, notes...'},
  'Mensagem (opcional)': {pt:'Mensagem (opcional)', en:'Message (optional)', es:'Mensaje (opcional)', fr:'Message (optionnel)'},
  'Meu perfil': {pt:'Meu perfil', en:'My profile', es:'Mi perfil', fr:'Mon profil'},
  'Mobiliário': {pt:'Mobiliário', en:'Furniture', es:'Mobiliario', fr:'Mobilier'},
  'Moradia': {pt:'Moradia', en:'Housing', es:'Vivienda', fr:'Logement'},
  'Mostrar/ocultar': {pt:'Mostrar/ocultar', en:'Show/hide', es:'Mostrar/ocultar', fr:'Afficher/masquer'},
  'Música': {pt:'Música', en:'Music', es:'Música', fr:'Musique'},
  'Navegador': {pt:'Navegador', en:'Browser', es:'Navegador', fr:'Navigateur'},
  'Navio': {pt:'Navio', en:'Ship', es:'Barco', fr:'Bateau'},
  'No dia': {pt:'No dia', en:'On the day', es:'En el día', fr:'Le jour'},
  'Nome *': {pt:'Nome *', en:'Name *', es:'Nombre *', fr:'Nom *'},
  'Nome completo': {pt:'Nome completo', en:'Full name', es:'Nombre completo', fr:'Nom complet'},
  'Nome da Conta *': {pt:'Nome da Conta *', en:'Account Name *', es:'Nombre de cuenta *', fr:'Nom du compte *'},
  'Nome da Família *': {pt:'Nome da Família *', en:'Family Name *', es:'Nombre de familia *', fr:'Nom de la famille *'},
  'Nome da lista *': {pt:'Nome da lista *', en:'List name *', es:'Nombre de la lista *', fr:'Nom de la liste *'},
  'Nome da nova conta': {pt:'Nome da nova conta', en:'New account name', es:'Nombre de la nueva cuenta', fr:'Nom du nouveau compte'},
  'Nome do Grupo *': {pt:'Nome do Grupo *', en:'Group Name *', es:'Nombre del grupo *', fr:'Nom du groupe *'},
  'Nome do Item *': {pt:'Nome do Item *', en:'Item Name *', es:'Nombre del artículo *', fr:'Nom de l\'article *'},
  'Nome do beneficiário': {pt:'Nome do beneficiário', en:'Payee name', es:'Nombre del beneficiario', fr:'Nom du bénéficiaire'},
  'Nome do item': {pt:'Nome do item', en:'Item name', es:'Nombre del artículo', fr:'Nom de l\'article'},
  'Nome do novo beneficiário *': {pt:'Nome do novo beneficiário *', en:'New payee name *', es:'Nombre del nuevo beneficiario *', fr:'Nom du nouveau bénéficiaire *'},
  'Notas...': {pt:'Notas...', en:'Notes...', es:'Notas...', fr:'Notes...'},
  'Nova Senha': {pt:'Nova Senha', en:'New Password', es:'Nueva contraseña', fr:'Nouveau mot de passe'},
  'Nova Senha (deixe em branco para não alterar)': {pt:'Nova Senha (deixe em branco para não alterar)', en:'New Password (leave blank to keep)', es:'Nueva contraseña (deje en blanco para mantener)', fr:'Nouveau mot de passe (laissez vide pour conserver)'},
  'Nova senha...': {pt:'Nova senha...', en:'New password...', es:'Nueva contraseña...', fr:'Nouveau mot de passe...'},
  'Novo estabelecimento': {pt:'Novo estabelecimento', en:'New store', es:'Nuevo establecimiento', fr:'Nouvel établissement'},
  'Observação': {pt:'Observação', en:'Note', es:'Observación', fr:'Observation'},
  'Observação desta ocorrência': {pt:'Observação desta ocorrência', en:'Note for this occurrence', es:'Observación de esta ocurrencia', fr:'Note pour cette occurrence'},
  'Observação opcional': {pt:'Observação opcional', en:'Optional note', es:'Observación opcional', fr:'Note optionnelle'},
  'Observações...': {pt:'Observações...', en:'Notes...', es:'Notas...', fr:'Notes...'},
  'Ocultar valores': {pt:'Ocultar valores', en:'Hide values', es:'Ocultar valores', fr:'Masquer les valeurs'},
  'Onde comprar': {pt:'Onde comprar', en:'Where to buy', es:'Dónde comprar', fr:'Où acheter'},
  'Opções': {pt:'Opções', en:'Options', es:'Opciones', fr:'Options'},
  'Padronizar Title Case em todos os nomes': {pt:'Padronizar Title Case em todos os nomes', en:'Standardize Title Case in all names', es:'Estandarizar Title Case en todos los nombres', fr:'Standardiser Title Case dans tous les noms'},
  'Perdas': {pt:'Perdas', en:'Losses', es:'Pérdidas', fr:'Pertes'},
  'Pergunte sobre suas finanças… (Enter para enviar)': {pt:'Pergunte sobre suas finanças… (Enter para enviar)', en:'Ask about your finances… (Enter to send)', es:'Pregunta sobre tus finanzas… (Enter para enviar)', fr:'Posez une question sur vos finances… (Entrée pour envoyer)'},
  'Personalizar dashboard': {pt:'Personalizar dashboard', en:'Customize dashboard', es:'Personalizar panel', fr:'Personnaliser le tableau de bord'},
  'Período': {pt:'Período', en:'Period', es:'Período', fr:'Période'},
  'Preço sugerido': {pt:'Preço sugerido', en:'Suggested price', es:'Precio sugerido', fr:'Prix suggéré'},
  'Primeira data *': {pt:'Primeira data *', en:'First date *', es:'Primera fecha *', fr:'Première date *'},
  'Pular configuração': {pt:'Pular configuração', en:'Skip setup', es:'Omitir configuración', fr:'Ignorer la configuration'},
  'Recibo ou nota fiscal': {pt:'Recibo ou nota fiscal', en:'Receipt or invoice', es:'Recibo o factura', fr:'Reçu ou facture'},
  'Recolher barra inferior': {pt:'Recolher barra inferior', en:'Collapse bottom bar', es:'Retraer barra inferior', fr:'Réduire la barre inférieure'},
  'Registrado em': {pt:'Registrado em', en:'Registered on', es:'Registrado el', fr:'Enregistré le'},
  'Religioso': {pt:'Religioso', en:'Religious', es:'Religioso', fr:'Religieux'},
  'Remédios': {pt:'Remédios', en:'Medicine', es:'Medicamentos', fr:'Médicaments'},
  'Repita a nova senha': {pt:'Repita a nova senha', en:'Repeat new password', es:'Repita la nueva contraseña', fr:'Répétez le nouveau mot de passe'},
  'Repita a senha': {pt:'Repita a senha', en:'Repeat password', es:'Repita la contraseña', fr:'Répétez le mot de passe'},
  'Restaurante': {pt:'Restaurante', en:'Restaurant', es:'Restaurante', fr:'Restaurant'},
  'Roupas': {pt:'Roupas', en:'Clothing', es:'Ropa', fr:'Vêtements'},
  'Saldo Final': {pt:'Saldo Final', en:'Final Balance', es:'Saldo final', fr:'Solde final'},
  'Saldo Inicial': {pt:'Saldo Inicial', en:'Initial Balance', es:'Saldo inicial', fr:'Solde initial'},
  'Saldo real (extrato) *': {pt:'Saldo real (extrato) *', en:'Actual balance (statement) *', es:'Saldo real (extracto) *', fr:'Solde réel (relevé) *'},
  'Salário': {pt:'Salário', en:'Salary', es:'Salario', fr:'Salaire'},
  'Salão/Barbearia': {pt:'Salão/Barbearia', en:'Salon/Barbershop', es:'Salón/Barbería', fr:'Salon/Barbier'},
  'Saúde': {pt:'Saúde', en:'Health', es:'Salud', fr:'Santé'},
  'Segue o relatório...': {pt:'Segue o relatório...', en:'Please find the report...', es:'A continuación el informe...', fr:'Veuillez trouver le rapport...'},
  'Selecionar todos': {pt:'Selecionar todos', en:'Select all', es:'Seleccionar todos', fr:'Tout sélectionner'},
  'Sem agrupamento': {pt:'Sem agrupamento', en:'No grouping', es:'Sin agrupación', fr:'Sans regroupement'},
  'Senha (mín. 8 chars)': {pt:'Senha (mín. 8 chars)', en:'Password (min. 8 chars)', es:'Contraseña (mín. 8 chars)', fr:'Mot de passe (min. 8 chars)'},
  'Senha Inicial': {pt:'Senha Inicial', en:'Initial Password', es:'Contraseña inicial', fr:'Mot de passe initial'},
  'Serviços': {pt:'Serviços', en:'Services', es:'Servicios', fr:'Services'},
  'Seu nome': {pt:'Seu nome', en:'Your name', es:'Su nombre', fr:'Votre nom'},
  'Sorte/Loteria': {pt:'Sorte/Loteria', en:'Lottery', es:'Lotería', fr:'Loterie'},
  'Streaming': {pt:'Streaming', en:'Streaming', es:'Streaming', fr:'Streaming'},
  'Supermercado': {pt:'Supermercado', en:'Supermarket', es:'Supermercado', fr:'Supermarché'},
  'Tags (vírgula)': {pt:'Tags (vírgula)', en:'Tags (comma)', es:'Etiquetas (coma)', fr:'Étiquettes (virgule)'},
  'Tecnologia': {pt:'Tecnologia', en:'Technology', es:'Tecnología', fr:'Technologie'},
  'Tipo *': {pt:'Tipo *', en:'Type *', es:'Tipo *', fr:'Type *'},
  'Tipo de orçamento': {pt:'Tipo de orçamento', en:'Budget type', es:'Tipo de presupuesto', fr:'Type de budget'},
  'Tipo padrão:': {pt:'Tipo padrão:', en:'Default type:', es:'Tipo predeterminado:', fr:'Type par défaut :'},
  'Todos os estabelecimentos': {pt:'Todos os estabelecimentos', en:'All stores', es:'Todos los establecimientos', fr:'Tous les établissements'},
  'Todos os status': {pt:'Todos os status', en:'All statuses', es:'Todos los estados', fr:'Tous les statuts'},
  'Todos os tipos': {pt:'Todos os tipos', en:'All types', es:'Todos los tipos', fr:'Tous les types'},
  'Trabalho': {pt:'Trabalho', en:'Work', es:'Trabajo', fr:'Travail'},
  'Transferir todos os registros para *': {pt:'Transferir todos os registros para *', en:'Transfer all records to *', es:'Transferir todos los registros a *', fr:'Transférer tous les enregistrements vers *'},
  'Trimestre atual': {pt:'Trimestre atual', en:'Current quarter', es:'Trimestre actual', fr:'Trimestre actuel'},
  'Unidade': {pt:'Unidade', en:'Unit', es:'Unidad', fr:'Unité'},
  'Usuário ativo': {pt:'Usuário ativo', en:'Active user', es:'Usuario activo', fr:'Utilisateur actif'},
  'Valor *': {pt:'Valor *', en:'Amount *', es:'Monto *', fr:'Montant *'},
  'Valor Unitário (R$)': {pt:'Valor Unitário (R$)', en:'Unit Price (BRL)', es:'Precio unitario (BRL)', fr:'Prix unitaire (BRL)'},
  'Valor Unitário (R$) *': {pt:'Valor Unitário (R$) *', en:'Unit Price (BRL) *', es:'Precio unitario (BRL) *', fr:'Prix unitaire (BRL) *'},
  'Valor limite *': {pt:'Valor limite *', en:'Limit amount *', es:'Valor límite *', fr:'Montant limite *'},
  'Valor real *': {pt:'Valor real *', en:'Actual amount *', es:'Monto real *', fr:'Montant réel *'},
  'Viagem': {pt:'Viagem', en:'Travel', es:'Viaje', fr:'Voyage'},
  'Viewer (somente leitura)': {pt:'Viewer (somente leitura)', en:'Viewer (read-only)', es:'Visualizador (solo lectura)', fr:'Lecteur (lecture seule)'},
  'Vincular à família existente': {pt:'Vincular à família existente', en:'Link to existing family', es:'Vincular a familia existente', fr:'Lier à une famille existante'},
  'Ótica': {pt:'Ótica', en:'Optician', es:'Óptica', fr:'Opticien'},
  'Ônibus/Metro': {pt:'Ônibus/Metro', en:'Bus/Metro', es:'Autobús/Metro', fr:'Bus/Métro'},
  'Últimos 12 meses': {pt:'Últimos 12 meses', en:'Last 12 months', es:'Últimos 12 meses', fr:'12 derniers mois'},
  'Ocorrência registrada, mas erro ao criar lançamento de entrada:': {pt:'Ocorrência registrada, mas erro ao criar lançamento de entrada:', en:'Occurrence registered, but error creating incoming transaction:', es:'Ocurrencia registrada, pero error al crear el asiento de entrada:', fr:'Occurrence enregistrée, mais erreur lors de la création de la transaction d\'entrée :'},
  'Transferência salva, mas erro ao criar lançamento de entrada:': {pt:'Transferência salva, mas erro ao criar lançamento de entrada:', en:'Transfer saved, but error creating incoming transaction:', es:'Transferencia guardada, pero error al crear el asiento de entrada:', fr:'Virement enregistré, mais erreur lors de la création de la transaction d\'entrée :'},
  'Nova Transação (cópia)': {pt:'Nova Transação (cópia)', en:'New Transaction (copy)', es:'Nueva transacción (copia)', fr:'Nouvelle transaction (copie)'},
  'Nunca executada': {pt:'Nunca executada', en:'Never run', es:'Nunca ejecutada', fr:'Jamais exécutée'},
  'RPC:': {pt:'RPC:', en:'RPC:', es:'RPC:', fr:'RPC :'},
  'Solicitação de': {pt:'Solicitação de', en:'Request from', es:'Solicitud de', fr:'Demande de'},
  'Módulo ${name} não está ativo para sua família.': {pt:'Módulo ${name} não está ativo para sua família.', en:'Module ${name} is not active for your family.', es:'El módulo ${name} no está activo para su familia.', fr:'Le module ${name} n\'est pas actif pour votre famille.'},
  'IOF de ${fmt(iofAmount, accountCurrency)} lançado automaticamente!': {pt:'IOF de ${fmt(iofAmount, accountCurrency)} lançado automaticamente!', en:'IOF of ${fmt(iofAmount, accountCurrency)} automatically recorded!', es:'IOF de ${fmt(iofAmount, accountCurrency)} registrado automáticamente!', fr:'IOF de ${fmt(iofAmount, accountCurrency)} enregistré automatiquement !'},
  'HTTP ${res.status}': {pt:'HTTP ${res.status}', en:'HTTP ${res.status}', es:'HTTP ${res.status}', fr:'HTTP ${res.status}'},
  'Solicitação de ${userName} removida.': {pt:'Solicitação de ${userName} removida.', en:'Request from ${userName} removed.', es:'Solicitud de ${userName} eliminada.', fr:'Demande de ${userName} supprimée.'},
  'Salvando…': {pt:'Salvando…', en:'Saving…', es:'Guardando…', fr:'Enregistrement…'},
  'Ganho/Perda': {pt:'Ganho/Perda', en:'Gain/Loss', es:'Ganancia/Pérdida', fr:'Gain/Perte'},
  'Valor Mercado': {pt:'Valor Mercado', en:'Market Value', es:'Valor de mercado', fr:'Valeur marché'},
  'Mapeie a coluna': {pt:'Mapeie a coluna', en:'Map the column', es:'Mapee la columna', fr:'Mappez la colonne'},
  'Mapeie ao menos uma coluna de': {pt:'Mapeie ao menos uma coluna de', en:'Map at least one column of', es:'Mapee al menos una columna de', fr:'Mappez au moins une colonne de'},
  'Chave inválida — deve começar com eyJ...': {pt:'Chave inválida — deve começar com eyJ...', en:'Invalid key — must start with eyJ...', es:'Clave inválida — debe comenzar con eyJ...', fr:'Clé invalide — doit commencer par eyJ...'},
  'Chave removida — reset de senha usará e-mail de recuperação.': {pt:'Chave removida — reset de senha usará e-mail de recuperação.', en:'Key removed — password reset will use recovery email.', es:'Clave eliminada — el restablecimiento usará el correo de recuperación.', fr:'Clé supprimée — la réinitialisation utilisera l\'e-mail de récupération.'},
  'Cole a chave completa antes de salvar.': {pt:'Cole a chave completa antes de salvar.', en:'Paste the full key before saving.', es:'Pegue la clave completa antes de guardar.', fr:'Collez la clé complète avant d\'enregistrer.'},
  'Falha ao carregar pdf.js': {pt:'Falha ao carregar pdf.js', en:'Failed to load pdf.js', es:'Error al cargar pdf.js', fr:'Échec du chargement de pdf.js'},
  'Chave inválida. Use apenas letras minúsculas, números, _ e .': {pt:'Chave inválida. Use apenas letras minúsculas, números, _ e .', en:'Invalid key. Use only lowercase letters, numbers, _ and .', es:'Clave inválida. Use solo letras minúsculas, números, _ y .', fr:'Clé invalide. Utilisez uniquement des minuscules, chiffres, _ et .'},
  'Esta chave já existe.': {pt:'Esta chave já existe.', en:'This key already exists.', es:'Esta clave ya existe.', fr:'Cette clé existe déjà.'},
  'Nova Chave de Tradução': {pt:'Nova Chave de Tradução', en:'New Translation Key', es:'Nueva clave de traducción', fr:'Nouvelle clé de traduction'},
  'Todas as seções': {pt:'Todas as seções', en:'All sections', es:'Todas las secciones', fr:'Toutes les sections'},
  'Editar Tradução': {pt:'Editar Tradução', en:'Edit Translation', es:'Editar traducción', fr:'Modifier la traduction'},
  'Solte em uma subcategoria para reparentar, ou use ✏️ para editar': {pt:'Solte em uma subcategoria para reparentar, ou use ✏️ para editar', en:'Drop into a subcategory to reparent, or use ✏️ to edit', es:'Suelte en una subcategoría para cambiar el padre, o use ✏️ para editar', fr:'Déposez dans une sous-catégorie pour changer le parent, ou utilisez ✏️ pour modifier'},
  'Fontes Pagadoras': {pt:'Fontes Pagadoras', en:'Payers', es:'Fuentes pagadoras', fr:'Sources de paiement'},
  'Bem-vindo ao Family FinTrack! 👋': {pt:'Bem-vindo ao Family FinTrack! 👋', en:'Welcome to Family FinTrack! 👋', es:'¡Bienvenido a Family FinTrack! 👋', fr:'Bienvenue sur Family FinTrack ! 👋'},
  'Configuração concluída com sucesso!': {pt:'Configuração concluída com sucesso!', en:'Setup completed successfully!', es:'¡Configuración completada con éxito!', fr:'Configuration terminée avec succès !'},
  'Configuração concluída · Clique para refazer': {pt:'Configuração concluída · Clique para refazer', en:'Setup complete · Click to redo', es:'Configuración completada · Haga clic para rehacer', fr:'Configuration terminée · Cliquez pour recommencer'},
  'Informe o nome da família.': {pt:'Informe o nome da família.', en:'Enter the family name.', es:'Ingrese el nombre de la familia.', fr:'Saisissez le nom de la famille.'},
  'Informe o nome do membro.': {pt:'Informe o nome do membro.', en:'Enter the member name.', es:'Ingrese el nombre del miembro.', fr:'Saisissez le nom du membre.'},
  'Adicione pelo menos um adulto': {pt:'Adicione pelo menos um adulto', en:'Add at least one adult', es:'Agregue al menos un adulto', fr:'Ajoutez au moins un adulte'},
  'Assinaturas & Streaming': {pt:'Assinaturas & Streaming', en:'Subscriptions & Streaming', es:'Suscripciones y Streaming', fr:'Abonnements & Streaming'},
  'Acompanhe suas finanças 📊': {pt:'Acompanhe suas finanças 📊', en:'Track your finances 📊', es:'Controle sus finanzas 📊', fr:'Suivez vos finances 📊'},
  'Bem-vindo ao Family FinTrack! 👋': {pt:'Bem-vindo ao Family FinTrack! 👋', en:'Welcome to Family FinTrack! 👋', es:'¡Bienvenido a Family FinTrack! 👋', fr:'Bienvenue sur Family FinTrack ! 👋'},
  'Configuração concluída com sucesso!': {pt:'Configuração concluída com sucesso!', en:'Setup completed successfully!', es:'¡Configuración completada con éxito!', fr:'Configuration terminée avec succès !'},
  'Configuração concluída · Clique para refazer': {pt:'Configuração concluída · Clique para refazer', en:'Setup complete · Click to redo', es:'Configuración completada · Haga clic para rehacer', fr:'Configuration terminée · Cliquez pour recommencer'},
  'Informe o nome da família.': {pt:'Informe o nome da família.', en:'Enter the family name.', es:'Ingrese el nombre de la familia.', fr:'Saisissez le nom de la famille.'},
  'Informe o nome do membro.': {pt:'Informe o nome do membro.', en:'Enter the member name.', es:'Ingrese el nombre del miembro.', fr:'Saisissez le nom du membre.'},
  'Adicione pelo menos um adulto': {pt:'Adicione pelo menos um adulto', en:'Add at least one adult', es:'Agregue al menos un adulto', fr:'Ajoutez au moins un adulte'},
  'Assinaturas & Streaming': {pt:'Assinaturas & Streaming', en:'Subscriptions & Streaming', es:'Suscripciones y Streaming', fr:'Abonnements & Streaming'},
  'Acompanhe suas finanças 📊': {pt:'Acompanhe suas finanças 📊', en:'Track your finances 📊', es:'Controle sus finanzas 📊', fr:'Suivez vos finances 📊'},
  'Configurar nome, membros e categorias da família': {pt:'Configurar nome, membros e categorias da família', en:'Set up family name, members and categories', es:'Configurar nombre, miembros y categorías de la familia', fr:'Configurer le nom, les membres et les catégories de la famille'},

  // ── Compound button labels (captured by text-node engine) ─────────────────
  '💾 Salvar':             {pt:'💾 Salvar',            en:'💾 Save',            es:'💾 Guardar',          fr:'💾 Enregistrer'},
  '💾 Salvar Grupo':       {pt:'💾 Salvar Grupo',      en:'💾 Save Group',      es:'💾 Guardar grupo',    fr:'💾 Enregistrer le groupe'},
  '💾 Salvar Preços':      {pt:'💾 Salvar Preços',     en:'💾 Save Prices',     es:'💾 Guardar precios',  fr:'💾 Enregistrer les prix'},
  '💾 Salvar chave':       {pt:'💾 Salvar chave',      en:'💾 Save key',        es:'💾 Guardar clave',    fr:'💾 Enregistrer la clé'},
  '💾 Salvar configuração':{pt:'💾 Salvar configuração',en:'💾 Save settings',  es:'💾 Guardar configuración',fr:'💾 Enregistrer la configuration'},
  '💾 Salvar Nova Senha':  {pt:'💾 Salvar Nova Senha', en:'💾 Save New Password',es:'💾 Guardar nueva contraseña',fr:'💾 Enregistrer le nouveau mot de passe'},
  '✕ Cancelar':            {pt:'✕ Cancelar',           en:'✕ Cancel',           es:'✕ Cancelar',          fr:'✕ Annuler'},
  '← Voltar ao login':     {pt:'← Voltar ao login',   en:'← Back to login',   es:'← Volver al login',  fr:'← Retour à la connexion'},
  'Aguardando aprovação':  {pt:'Aguardando aprovação', en:'Awaiting approval',  es:'Esperando aprobación',fr:"En attente d'approbation"},
  'Carregar ao entrar':    {pt:'Carregar ao entrar',   en:'Load on sign in',    es:'Cargar al entrar',   fr:'Charger à la connexion'},
  'Família preferida':     {pt:'Família preferida',    en:'Preferred family',   es:'Familia preferida',  fr:'Famille préférée'},
  'Pré-selecionada em qualquer dispositivo ao fazer login.': {pt:'Pré-selecionada em qualquer dispositivo ao fazer login.', en:'Pre-selected on any device when you sign in.', es:'Preseleccionada en cualquier dispositivo al iniciar sesión.', fr:'Présélectionnée sur n\'importe quel appareil lors de la connexion.'},
  'Nova Transação':        {pt:'Nova Transação',       en:'New Transaction',    es:'Nueva transacción',  fr:'Nouvelle transaction'},
  'Editar Transação':      {pt:'Editar Transação',     en:'Edit Transaction',   es:'Editar transacción', fr:'Modifier la transaction'},
  'Nova Conta':            {pt:'Nova Conta',           en:'New Account',        es:'Nueva cuenta',       fr:'Nouveau compte'},
  'Editar Conta':          {pt:'Editar Conta',         en:'Edit Account',       es:'Editar cuenta',      fr:'Modifier le compte'},
  'Novo Programado':       {pt:'Novo Programado',      en:'New Scheduled',      es:'Nuevo programado',   fr:'Nouveau programmé'},
  'Editar Programado':     {pt:'Editar Programado',    en:'Edit Scheduled',     es:'Editar programado',  fr:'Modifier le programmé'},
  'Registrar agora':       {pt:'Registrar agora',      en:'Register now',       es:'Registrar ahora',    fr:'Enregistrer maintenant'},
  'Pular':                 {pt:'Pular',                en:'Skip',               es:'Omitir',             fr:'Ignorer'},
  'Confirmar':             {pt:'Confirmar',            en:'Confirm',            es:'Confirmar',          fr:'Confirmer'},
  'CONFIRMADAS':           {pt:'CONFIRMADAS',          en:'CONFIRMED',          es:'CONFIRMADAS',        fr:'CONFIRMÉES'},
  'PENDENTES':             {pt:'PENDENTES',            en:'PENDING',            es:'PENDIENTES',         fr:'EN ATTENTE'},
  'Nenhuma transação encontrada': {pt:'Nenhuma transação encontrada', en:'No transactions found', es:'Sin transacciones encontradas', fr:'Aucune transaction trouvée'},
  'Nenhum lançamento programado': {pt:'Nenhum lançamento programado', en:'No scheduled transactions', es:'Sin transacciones programadas', fr:'Aucune transaction programmée'},
  'Nenhuma conta encontrada':     {pt:'Nenhuma conta encontrada',     en:'No accounts found',          es:'No se encontraron cuentas',    fr:'Aucun compte trouvé'},
  'Sem beneficiário':      {pt:'Sem beneficiário',    en:'No payee',           es:'Sin beneficiario',   fr:'Sans bénéficiaire'},
  'Sem categoria':         {pt:'Sem categoria',       en:'No category',        es:'Sin categoría',      fr:'Sans catégorie'},
  'Sem conta':             {pt:'Sem conta',           en:'No account',         es:'Sin cuenta',         fr:'Sans compte'},
  'lanç.':                 {pt:'lanç.',               en:'entries',            es:'registros',          fr:'entrées'},
  'Ajuste de Saldo':       {pt:'Ajuste de Saldo',     en:'Balance Adjustment', es:'Ajuste de saldo',    fr:'Ajustement de solde'},
  'Pagamento de fatura':   {pt:'Pagamento de fatura', en:'Card payment',       es:'Pago de factura',    fr:'Paiement de facture'},
  'Transferência interna': {pt:'Transferência interna',en:'Internal transfer',  es:'Transferencia interna',fr:'Virement interne'},
  'Conta Corrente':        {pt:'Conta Corrente',      en:'Checking',           es:'Cuenta corriente',   fr:'Compte courant'},
  'Poupança':              {pt:'Poupança',            en:'Savings',            es:'Ahorros',            fr:'Épargne'},
  'Cartão de Crédito':     {pt:'Cartão de Crédito',   en:'Credit Card',        es:'Tarjeta de crédito', fr:'Carte de crédit'},
  'Carteira/Dinheiro':     {pt:'Carteira/Dinheiro',   en:'Wallet/Cash',        es:'Cartera/Efectivo',   fr:'Portefeuille/Espèces'},
  'Uma vez':               {pt:'Uma vez',             en:'Once',               es:'Una vez',            fr:'Une fois'},
  'Quinzenal':             {pt:'Quinzenal',           en:'Biweekly',           es:'Quincenal',          fr:'Bimensuel'},
  'Bimestral':             {pt:'Bimestral',           en:'Bimonthly',          es:'Bimestral',          fr:'Bimestriel'},
  'Trimestral':            {pt:'Trimestral',          en:'Quarterly',          es:'Trimestral',         fr:'Trimestriel'},
  'Semestral':             {pt:'Semestral',           en:'Semiannual',         es:'Semestral',          fr:'Semestriel'},
  'Mensal':                {pt:'Mensal',              en:'Monthly',            es:'Mensual',            fr:'Mensuel'},
  'Anual':                 {pt:'Anual',               en:'Annual',             es:'Anual',              fr:'Annuel'},
  'Semanal':               {pt:'Semanal',             en:'Weekly',             es:'Semanal',            fr:'Hebdomadaire'},
  'Personalizado':         {pt:'Personalizado',       en:'Custom',             es:'Personalizado',      fr:'Personnalisé'},
  'Projeção de Cartões de Crédito': {pt:'Projeção de Cartões de Crédito', en:'Credit Card Projection', es:'Proyección de tarjetas de crédito', fr:'Projection des cartes de crédit'},
  'Prognóstico Financeiro — 6 meses': {pt:'Prognóstico Financeiro — 6 meses', en:'Financial Forecast — 6 months', es:'Pronóstico financiero — 6 meses', fr:'Prévision financière — 6 mois'},
  'Análise gerada por Google Gemini · Family FinTrack': {pt:'Análise gerada por Google Gemini · Family FinTrack', en:'Analysis generated by Google Gemini · Family FinTrack', es:'Análisis generado por Google Gemini · Family FinTrack', fr:'Analyse générée par Google Gemini · Family FinTrack'},

};

// ── Estado interno ───────────────────────────────────────────────────────────
let _i18nLang  = I18N_DEFAULT_LANG;
let _i18nDict  = {};   // { 'key': 'translated string' }
let _i18nReady = false;
let _i18nReadyCallbacks = [];

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Traduz uma chave.
 * @param {string} key   e.g. "dashboard.title"
 * @param {Object} vars  e.g. { name: 'João', count: 3 }
 * @returns {string}
 */
function t(key, vars) {
  let str = _i18nDict[key];
  // Fallback 1: dicionário embutido (funciona sem banco)
  if (!str) {
    const entry = _I18N_BUILTIN[key];
    if (entry) str = entry[_i18nLang] || entry['pt'] || null;
  }
  if (!str) str = _i18nFallback(key);
  if (!str) str = key; // último recurso: mostra a chave

  if (vars && typeof vars === 'object') {
    str = str.replace(/\{\{(\w+)\}\}/g, (_, k) =>
      vars[k] !== undefined ? vars[k] : `{{${k}}}`
    );
  }
  return str;
}

/**
 * Inicializa o i18n: carrega traduções do banco/cache.
 * Chamado uma vez no boot do app.
 */
async function i18nInit() {
  try {
    // 1. Detecta idioma preferido com hierarquia:
    //    user.preferred_language (DB) → localStorage → family default → 'pt'
    //
    //    Nota: auth.js popula localStorage com preferred_language do usuário
    //    ANTES de chamar bootApp() → i18nInit() sempre encontra o valor certo.
    //    Aqui mantemos a leitura do localStorage como fonte primária segura.
    const userLang    = localStorage.getItem(I18N_CACHE_LANG_KEY);
    // Family default: tenta ler do cache de preferências (carregado por family_prefs.js)
    const familyLang  = (typeof getFamilyPreferences === 'function')
      ? null  // será aplicado depois — family_prefs carrega em paralelo com i18nInit
      : null;
    const savedLang   = userLang || familyLang || I18N_DEFAULT_LANG;
    _i18nLang = I18N_SUPPORTED.includes(savedLang) ? savedLang : I18N_DEFAULT_LANG;

    // 2. Tenta cache local válido
    const cached = _i18nReadCache(_i18nLang);
    if (cached) {
      _i18nDict  = cached;
      _i18nReady = true;
      _i18nRunCallbacks();
      // Revalida em background (não bloqueia boot)
      _i18nLoadFromDB(_i18nLang, true);
      return;
    }

    // 3. Carrega do banco
    await _i18nLoadFromDB(_i18nLang, false);

  } catch (e) {
    console.warn('[i18n] Init failed, using keys as fallback:', e.message);
    _i18nReady = true;
    _i18nRunCallbacks();
  }
}

/**
 * Muda o idioma do usuário e re-renderiza elementos marcados com data-i18n.
 * Persiste a preferência no localStorage E no perfil do usuário (Supabase).
 */
async function i18nSetLanguage(lang) {
  if (!I18N_SUPPORTED.includes(lang)) {
    console.warn('[i18n] Unsupported language:', lang);
    return;
  }

  const prevLang = _i18nLang;
  _i18nLang = lang;
  localStorage.setItem(I18N_CACHE_LANG_KEY, lang);

  // ── FIX: invalida reverse-map ao trocar idioma ───────────────────────────
  // O reverse-map é construído a partir do PT (língua base) e é reutilizável,
  // mas o dict de DB pode ter mudado → força rebuild na próxima chamada.
  _i18nReverseMap = null;

  // Carrega novas traduções
  const cached = _i18nReadCache(lang);
  if (cached) {
    _i18nDict = cached;
    // Background revalidation if cache is stale
    _i18nLoadFromDB(lang, true).catch(() => {});
  } else {
    await _i18nLoadFromDB(lang, false);
  }

  // Atualiza todos os elementos data-i18n na página
  i18nApplyToDOM();

  // Persiste no perfil do usuário (best-effort, não bloqueia)
  if (window.sb && window.currentUser?.id) {
    sb.from('app_users')
      .update({ preferred_language: lang })
      .eq('id', currentUser.id)
      .then(() => { if (window.currentUser) currentUser.preferred_language = lang; })
      .catch(e => console.warn('[i18n] Could not save language preference:', e.message));
  }

  // Atualiza o html lang attribute
  document.documentElement.lang = _i18nLangToLocale(lang);

  // Dispara evento para que módulos possam re-renderizar
  // Só dispara se idioma realmente mudou (evita re-renders duplos no boot)
  if (lang !== prevLang || !prevLang) {
    document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang, prevLang } }));
  }
}

/**
 * Retorna o idioma atual.
 */
function i18nGetLanguage() { return _i18nLang; }

/**
 * Aplica traduções a todos os elementos com data-i18n na DOM.
 * Também aplica data-i18n-placeholder e data-i18n-title.
 */
function i18nApplyToDOM(root) {
  const scope = root || document;
  const isDoc = (scope === document);

  // 1. data-i18n explicit keys (highest priority, exact mapping)
  scope.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    let str = _i18nDict[key];
    if (!str) {
      const entry = _I18N_BUILTIN[key];
      if (entry) str = entry[_i18nLang] || entry['pt'] || null;
    }
    if (str) el.textContent = str;
  });

  // 2. Placeholders
  scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.placeholder = t(key);
  });

  // 3. Title/aria-label
  scope.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
  });

  // 4. HTML content
  scope.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key);
  });

  // 5. Text-node engine — translates ALL visible text in the DOM
  //    by matching against the PT→key reverse map.
  //    Only runs when language is not PT (no-op for default language).
  if (_i18nLang !== 'pt') {
    // For full document: scope to app shell (skip login screen)
    const walkRoot = isDoc
      ? (document.getElementById('mainApp') || document.getElementById('sidebar') || scope)
      : scope;
    _i18nWalkTextNodes(walkRoot);
    // Also walk sidebar explicitly (it's outside mainApp)
    if (isDoc) {
      const sb = document.getElementById('sidebar');
      if (sb) _i18nWalkTextNodes(sb);
    }
  }
}

/**
 * Registra callback para quando as traduções estiverem prontas.
 */
function i18nOnReady(cb) {
  if (_i18nReady) { cb(); return; }
  _i18nReadyCallbacks.push(cb);
}

/**
 * Retorna lista de idiomas disponíveis com labels.
 */
function i18nGetAvailableLanguages() {
  return [
    { code: 'pt', label: 'Português', flag: '🇧🇷' },
    { code: 'en', label: 'English',   flag: '🇺🇸' },
    { code: 'es', label: 'Español',   flag: '🇪🇸' },
    { code: 'fr', label: 'Français',  flag: '🇫🇷' },
  ];
}

// ── Admin API (usado pelo painel de traduções) ────────────────────────────────

/** Carrega TODAS as traduções de TODOS os idiomas (para o admin). */
async function i18nAdminLoadAll() {
  const { data, error } = await sb
    .from('i18n_translations')
    .select('*')
    .order('key_name');
  if (error) throw error;
  return data || [];
}

/** Salva / atualiza uma linha de tradução. */
async function i18nAdminSave(row) {
  // row: { key_name, section, pt, en, es, fr, description }
  const { data, error } = await sb
    .from('i18n_translations')
    .upsert(row, { onConflict: 'key_name' })
    .select()
    .single();
  if (error) throw error;
  // Invalida cache de todos os idiomas
  I18N_SUPPORTED.forEach(lang => _i18nClearCache(lang));
  return data;
}

/** Deleta uma chave de tradução. */
async function i18nAdminDelete(keyName) {
  const { error } = await sb
    .from('i18n_translations')
    .delete()
    .eq('key_name', keyName);
  if (error) throw error;
  I18N_SUPPORTED.forEach(lang => _i18nClearCache(lang));
}

/** Força recarga do cache do idioma atual. */
async function i18nReload() {
  _i18nClearCache(_i18nLang);
  await _i18nLoadFromDB(_i18nLang, false);
  i18nApplyToDOM();
}

// ── Internos ─────────────────────────────────────────────────────────────────

async function _i18nLoadFromDB(lang, background) {
  if (!window.sb) return;
  try {
    const col = lang === 'pt' ? 'default_text' : lang;
    const { data, error } = await sb
      .from('i18n_translations')
      .select(`key_name,${col}`)
      .order('key_name');

    if (error) throw error;

    const dict = {};
    (data || []).forEach(row => {
      const text = row[col] || row['default_text'] || row['key_name'];
      if (text) dict[row.key_name] = text;
    });

    _i18nDict = dict;
    _i18nWriteCache(lang, dict);

    if (!background) {
      _i18nReady = true;
      _i18nRunCallbacks();
    }
  } catch(e) {
    console.warn('[i18n] DB load failed:', e.message);
    if (!background) {
      _i18nReady = true;
      _i18nRunCallbacks();
    }
  }
}

function _i18nFallback(key) {
  // Se o dicionário atual não tem a chave, tenta pt
  // (para os casos onde pt é o padrão e outros idiomas têm lacunas)
  return null;
}

function _i18nReadCache(lang) {
  try {
    const raw = localStorage.getItem(`${I18N_CACHE_KEY}_${lang}`);
    if (!raw) return null;
    const { ts, dict } = JSON.parse(raw);
    if (Date.now() - ts > I18N_CACHE_TTL_MS) { localStorage.removeItem(`${I18N_CACHE_KEY}_${lang}`); return null; }
    return dict;
  } catch { return null; }
}

function _i18nWriteCache(lang, dict) {
  try {
    localStorage.setItem(`${I18N_CACHE_KEY}_${lang}`, JSON.stringify({ ts: Date.now(), dict }));
  } catch(e) {
    console.warn('[i18n] Cache write failed:', e.message);
  }
}

function _i18nClearCache(lang) {
  localStorage.removeItem(`${I18N_CACHE_KEY}_${lang}`);
}

function _i18nRunCallbacks() {
  _i18nReadyCallbacks.forEach(cb => { try { cb(); } catch(e) { console.warn(e); } });
  _i18nReadyCallbacks = [];
}

function _i18nLangToLocale(lang) {
  return { pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR' }[lang] || lang;
}

// ── Reverse-map text-node engine ─────────────────────────────────────────────
// Maps Portuguese text → translation key, built from _I18N_BUILTIN at runtime.
// This allows translating ALL rendered content — JS innerHTML, static HTML,
// without requiring data-i18n on every element.
let _i18nReverseMap = null; // { 'pt text': 'key' }

function _i18nBuildReverseMap() {
  _i18nReverseMap = {};
  for (const [key, langs] of Object.entries(_I18N_BUILTIN)) {
    const ptText = langs.pt;
    if (ptText) _i18nReverseMap[ptText.trim()] = key;
  }
}

/**
 * Translate a single text string using the builtin dict.
 * Falls back to returning the original string if not found.
 */
function _i18nTranslateText(text) {
  if (_i18nLang === 'pt') return text; // no-op for Portuguese
  const trimmed = text.trim();
  if (!trimmed) return text;

  // 1. Try direct dict lookup (DB translations)
  if (_i18nDict[trimmed]) return text.replace(trimmed, _i18nDict[trimmed]);

  // 2. Try reverse map (PT text → key → translation)
  if (!_i18nReverseMap) _i18nBuildReverseMap();
  const key = _i18nReverseMap[trimmed];
  if (key) {
    const entry = _I18N_BUILTIN[key];
    if (entry) {
      const translated = entry[_i18nLang] || entry['pt'];
      if (translated) return text.replace(trimmed, translated);
    }
  }

  return text; // untranslatable — return original
}

/**
 * Walk all visible text nodes in an element tree and translate them.
 * Skips: scripts, styles, inputs, SVGs, code, elements with data-i18n-skip.
 */
function _i18nWalkTextNodes(root) {
  if (!root || _i18nLang === 'pt') return;
  if (!_i18nReverseMap) _i18nBuildReverseMap();

  const SKIP_TAGS = new Set(['SCRIPT','STYLE','INPUT','TEXTAREA','SELECT','OPTION','CODE','PRE','SVG','PATH','USE','SYMBOL','CANVAS','NOSCRIPT']);
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-i18n-skip],[data-no-translate]')) return NodeFilter.FILTER_REJECT;
        if (p.closest('script,style,svg')) return NodeFilter.FILTER_REJECT;
        const text = node.textContent.trim();
        if (!text || text.length < 2) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);

  for (const n of nodes) {
    const original = n.textContent;
    const translated = _i18nTranslateText(original);
    if (translated !== original) n.textContent = translated;
  }
}

// Auto-aplicar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    i18nApplyToDOM(document);
    i18nOnReady(() => i18nApplyToDOM(document));
  }, 0);
});

// Expõe globalmente
window.t               = t;
window.i18nInit        = i18nInit;
window.i18nSetLanguage = i18nSetLanguage;
window.i18nGetLanguage = i18nGetLanguage;
window.i18nApplyToDOM  = i18nApplyToDOM;
window.i18nOnReady     = i18nOnReady;
window.i18nGetAvailableLanguages = i18nGetAvailableLanguages;
window.i18nAdminLoadAll = i18nAdminLoadAll;
window.i18nAdminSave    = i18nAdminSave;
window.i18nAdminDelete  = i18nAdminDelete;
window.i18nReload       = i18nReload;


// === PERIODICITY COLORS ===
function getPeriodColor(period) {
  switch((period||'').toLowerCase()) {
    case 'daily': return '#2ecc71';
    case 'weekly': return '#3498db';
    case 'monthly': return '#f39c12';
    case 'yearly': return '#9b59b6';
    default: return '#1F6B4F';
  }
}
