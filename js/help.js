/* ═══════════════════════════════════════════════════════════════════════════
   HELP — Central de Ajuda · Family FinTrack
   Documentação completa em PT · EN · ES · FR
   Arquitetura: dados em JS (sem DB), filtro client-side, sidebar + artigo
═══════════════════════════════════════════════════════════════════════════ */

const _help = { currentSection: null, currentArticle: null, searchQuery: '' };

function _ht(obj) {
  const lang = (typeof i18nGetLanguage === 'function') ? i18nGetLanguage() : 'pt';
  return obj[lang] || obj['pt'] || '';
}

function _helpContent() {
  return [
    {
      id: 'getting-started', icon: '🚀', color: '#2563eb',
      title: { pt: 'Primeiros Passos', en: 'Getting Started', es: 'Primeros pasos', fr: 'Premiers pas' },
      articles: [
        {
          id: 'what-is',
          title: { pt: 'O que é o Family FinTrack?', en: 'What is Family FinTrack?', es: '¿Qué es Family FinTrack?', fr: "Qu'est-ce que Family FinTrack?" },
          body: {
            pt: `<p>O <strong>Family FinTrack</strong> é um aplicativo de gestão financeira familiar que permite controlar receitas, despesas, investimentos e orçamentos de toda a família em um único lugar.</p><h4>Para que serve?</h4><ul><li>Registrar e categorizar todos os lançamentos financeiros</li><li>Acompanhar saldos de múltiplas contas (corrente, poupança, investimentos)</li><li>Definir e monitorar orçamentos por categoria</li><li>Visualizar relatórios e gráficos de evolução financeira</li><li>Planejar o futuro com previsão de fluxo de caixa</li><li>Gerenciar transações programadas e recorrentes</li></ul><h4>Quem pode usar?</h4><p>O app é multi-usuário. Você pode convidar membros da família, cada um com seu nível de acesso (Owner, Admin ou Visualizador).</p><div class="help-tip">💡 <strong>Dica:</strong> Comece cadastrando suas contas bancárias e as principais categorias antes de lançar transações.</div>`,
            en: `<p><strong>Family FinTrack</strong> is a family financial management app that lets you track income, expenses, investments and budgets for your whole family in one place.</p><h4>What is it for?</h4><ul><li>Record and categorize all financial transactions</li><li>Monitor balances across multiple accounts</li><li>Set and track budgets by category</li><li>View financial evolution reports and charts</li><li>Plan for the future with cash flow forecasting</li><li>Manage scheduled and recurring transactions</li></ul><div class="help-tip">💡 <strong>Tip:</strong> Start by registering your bank accounts and main categories before entering transactions.</div>`,
            es: `<p><strong>Family FinTrack</strong> es una aplicación de gestión financiera familiar que permite controlar ingresos, gastos, inversiones y presupuestos en un solo lugar.</p><h4>¿Para qué sirve?</h4><ul><li>Registrar y categorizar todas las transacciones financieras</li><li>Seguir saldos en múltiples cuentas</li><li>Definir y monitorear presupuestos por categoría</li><li>Ver informes y gráficos de evolución financiera</li></ul><div class="help-tip">💡 <strong>Consejo:</strong> Empiece registrando sus cuentas bancarias y las principales categorías.</div>`,
            fr: `<p><strong>Family FinTrack</strong> est une application de gestion financière familiale qui permet de suivre revenus, dépenses, investissements et budgets en un seul endroit.</p><h4>À quoi sert-elle?</h4><ul><li>Enregistrer et catégoriser toutes les transactions financières</li><li>Suivre les soldes sur plusieurs comptes</li><li>Définir et suivre des budgets par catégorie</li><li>Visualiser rapports et graphiques d'évolution financière</li></ul><div class="help-tip">💡 <strong>Conseil:</strong> Commencez par enregistrer vos comptes bancaires et les principales catégories.</div>`,
          },
        },
        {
          id: 'navigation',
          title: { pt: 'Navegando no app', en: 'Navigating the app', es: 'Navegando en la app', fr: "Naviguer dans l'app" },
          body: {
            pt: `<h4>Menu lateral (Sidebar)</h4><p>No desktop, o menu lateral esquerdo dá acesso a todas as seções. No mobile, use a barra de navegação inferior ou o ícone ☰ no topo.</p><div class="help-card-grid"><div class="help-mini-card"><strong>🏠 Dashboard</strong>Visão geral das finanças com KPIs e gráficos</div><div class="help-mini-card"><strong>💸 Lançamentos</strong>Lista completa de receitas e despesas</div><div class="help-mini-card"><strong>🏦 Contas</strong>Suas contas bancárias e carteiras</div><div class="help-mini-card"><strong>📊 Relatórios</strong>Análises e gráficos detalhados</div><div class="help-mini-card"><strong>🎯 Orçamentos</strong>Limite de gastos por categoria</div><div class="help-mini-card"><strong>🏷️ Categorias</strong>Organização dos lançamentos</div><div class="help-mini-card"><strong>👥 Beneficiários</strong>Lojas, pessoas e empresas</div><div class="help-mini-card"><strong>📅 Programados</strong>Cobranças e pagamentos recorrentes</div></div><div class="help-tip">💡 O idioma pode ser alterado no menu superior (ícone 🌐) ou nas configurações do perfil.</div>`,
            en: `<h4>Sidebar menu</h4><p>On desktop, the left sidebar gives access to all sections. On mobile, use the bottom navigation bar or the ☰ icon at the top.</p><div class="help-card-grid"><div class="help-mini-card"><strong>🏠 Dashboard</strong>Financial overview with KPIs and charts</div><div class="help-mini-card"><strong>💸 Transactions</strong>Complete list of income and expenses</div><div class="help-mini-card"><strong>🏦 Accounts</strong>Your bank accounts and wallets</div><div class="help-mini-card"><strong>📊 Reports</strong>Detailed analysis and charts</div><div class="help-mini-card"><strong>🎯 Budgets</strong>Spending limits by category</div><div class="help-mini-card"><strong>🏷️ Categories</strong>Transaction organization</div><div class="help-mini-card"><strong>👥 Payees</strong>Stores, people and companies</div><div class="help-mini-card"><strong>📅 Scheduled</strong>Recurring bills and payments</div></div><div class="help-tip">💡 Language can be changed from the top menu (🌐 icon) or in profile settings.</div>`,
            es: `<h4>Menú lateral</h4><p>En escritorio, el menú lateral izquierdo da acceso a todas las secciones. En móvil, use la barra de navegación inferior o el ícono ☰.</p><div class="help-card-grid"><div class="help-mini-card"><strong>🏠 Panel</strong>Resumen financiero</div><div class="help-mini-card"><strong>💸 Transacciones</strong>Lista completa</div><div class="help-mini-card"><strong>🏦 Cuentas</strong>Cuentas bancarias</div><div class="help-mini-card"><strong>📊 Informes</strong>Análisis detallados</div></div>`,
            fr: `<h4>Menu latéral</h4><p>Sur desktop, le menu latéral gauche donne accès à toutes les sections. Sur mobile, utilisez la barre de navigation inférieure ou l'icône ☰.</p><div class="help-card-grid"><div class="help-mini-card"><strong>🏠 Tableau de bord</strong>Vue d'ensemble</div><div class="help-mini-card"><strong>💸 Transactions</strong>Liste complète</div><div class="help-mini-card"><strong>🏦 Comptes</strong>Comptes bancaires</div><div class="help-mini-card"><strong>📊 Rapports</strong>Analyses détaillées</div></div>`,
          },
        },
      ],
    },
    {
      id: 'accounts', icon: '🏦', color: '#0891b2',
      title: { pt: 'Contas', en: 'Accounts', es: 'Cuentas', fr: 'Comptes' },
      articles: [
        {
          id: 'accounts-types',
          title: { pt: 'Tipos de conta', en: 'Account types', es: 'Tipos de cuenta', fr: 'Types de compte' },
          body: {
            pt: `<p>As contas representam seus ativos financeiros reais.</p><div class="help-card-grid"><div class="help-mini-card"><strong>Corrente</strong>Movimentações do dia a dia</div><div class="help-mini-card"><strong>Poupança</strong>Reserva financeira com rendimento</div><div class="help-mini-card"><strong>Cartão de Crédito</strong>Acompanhe faturas e gastos</div><div class="help-mini-card"><strong>Investimentos</strong>Renda fixa, ações, FIIs</div><div class="help-mini-card"><strong>Dinheiro</strong>Carteira física em espécie</div><div class="help-mini-card"><strong>Outro</strong>Qualquer ativo não listado</div></div><h4>Moeda estrangeira</h4><p>Cada conta pode ter sua própria moeda (BRL, USD, EUR). Transações em moeda estrangeira são convertidas automaticamente para BRL.</p><div class="help-tip">💡 Mantenha o saldo inicial correto ao criar a conta para que o saldo atual seja preciso desde o primeiro dia.</div>`,
            en: `<p>Accounts represent your real financial assets.</p><div class="help-card-grid"><div class="help-mini-card"><strong>Checking</strong>Day-to-day transactions</div><div class="help-mini-card"><strong>Savings</strong>Financial reserve with yield</div><div class="help-mini-card"><strong>Credit Card</strong>Track bills and spending</div><div class="help-mini-card"><strong>Investments</strong>Fixed income, stocks</div><div class="help-mini-card"><strong>Cash</strong>Physical wallet</div><div class="help-mini-card"><strong>Other</strong>Any unlisted asset</div></div><h4>Foreign currency</h4><p>Each account can have its own currency. Foreign currency transactions are automatically converted to BRL.</p><div class="help-tip">💡 Set the correct opening balance when creating an account for accurate balances from day one.</div>`,
            es: `<p>Las cuentas representan sus activos financieros reales.</p><div class="help-card-grid"><div class="help-mini-card"><strong>Corriente</strong>Movimientos diarios</div><div class="help-mini-card"><strong>Ahorros</strong>Reserva financiera</div><div class="help-mini-card"><strong>Tarjeta de crédito</strong>Facturas y gastos</div><div class="help-mini-card"><strong>Inversiones</strong>Renta fija, acciones</div></div>`,
            fr: `<p>Les comptes représentent vos actifs financiers réels.</p><div class="help-card-grid"><div class="help-mini-card"><strong>Courant</strong>Opérations quotidiennes</div><div class="help-mini-card"><strong>Épargne</strong>Réserve financière</div><div class="help-mini-card"><strong>Carte de crédit</strong>Factures et dépenses</div><div class="help-mini-card"><strong>Investissements</strong>Actions, obligations</div></div>`,
          },
        },
        {
          id: 'accounts-groups',
          title: { pt: 'Grupos de contas', en: 'Account groups', es: 'Grupos de cuentas', fr: 'Groupes de comptes' },
          body: {
            pt: `<p>Agrupe contas por banco, pessoa ou finalidade para facilitar a visualização.</p><h4>Como criar um grupo</h4><ol><li>Acesse <strong>Contas</strong> no menu lateral</li><li>Clique em <strong>+ Novo Grupo</strong></li><li>Defina o nome e a cor do grupo</li><li>Ao criar ou editar uma conta, selecione o grupo desejado</li></ol><div class="help-tip">💡 Exemplo: crie grupos "Banco do Brasil", "Nubank" e "Dinheiro Físico" para organizar por instituição.</div>`,
            en: `<p>Group accounts by bank, person or purpose for easier viewing.</p><ol><li>Go to <strong>Accounts</strong> in the sidebar</li><li>Click <strong>+ New Group</strong></li><li>Set the group name and color</li><li>When creating/editing an account, select the group</li></ol><div class="help-tip">💡 Example: create groups "Chase", "Savings" and "Cash" to organize by institution.</div>`,
            es: `<p>Agrupe cuentas por banco, persona o propósito.</p><ol><li>Vaya a <strong>Cuentas</strong></li><li>Haga clic en <strong>+ Nuevo grupo</strong></li><li>Defina el nombre y el color</li></ol>`,
            fr: `<p>Regroupez les comptes par banque, personne ou usage.</p><ol><li>Allez dans <strong>Comptes</strong></li><li>Cliquez sur <strong>+ Nouveau groupe</strong></li><li>Définissez le nom et la couleur</li></ol>`,
          },
        },
      ],
    },
    {
      id: 'transactions', icon: '💸', color: '#16a34a',
      title: { pt: 'Lançamentos', en: 'Transactions', es: 'Transacciones', fr: 'Transactions' },
      articles: [
        {
          id: 'tx-types',
          title: { pt: 'Tipos de lançamento', en: 'Transaction types', es: 'Tipos de transacción', fr: 'Types de transaction' },
          body: {
            pt: `<div class="help-card-grid"><div class="help-mini-card"><strong>💰 Receita</strong>Dinheiro que entra: salário, renda extra, reembolsos</div><div class="help-mini-card"><strong>💸 Despesa</strong>Dinheiro que sai: compras, contas, serviços</div><div class="help-mini-card"><strong>🔄 Transferência</strong>Movimentação entre suas próprias contas</div></div><h4>Status dos lançamentos</h4><ul><li><strong>Confirmado:</strong> lançamento efetivado, afeta o saldo da conta</li><li><strong>Pendente:</strong> previsto mas ainda não ocorrido (ex: boleto a vencer)</li></ul><div class="help-tip">💡 Use lançamentos pendentes para planejar gastos futuros sem afetar o saldo atual.</div><h4>Campos importantes</h4><ul><li><strong>Data:</strong> data real do lançamento ou da competência</li><li><strong>Valor:</strong> valor positivo — o sistema aplica o sinal conforme o tipo</li><li><strong>Categoria:</strong> classifica o lançamento para relatórios</li><li><strong>Beneficiário:</strong> quem recebeu ou pagou</li><li><strong>Memo:</strong> detalhes extras para referência futura</li></ul>`,
            en: `<div class="help-card-grid"><div class="help-mini-card"><strong>💰 Income</strong>Money in: salary, extra income, reimbursements</div><div class="help-mini-card"><strong>💸 Expense</strong>Money out: purchases, bills, services</div><div class="help-mini-card"><strong>🔄 Transfer</strong>Movement between your own accounts</div></div><h4>Transaction status</h4><ul><li><strong>Confirmed:</strong> completed, affects account balance</li><li><strong>Pending:</strong> planned but not yet occurred</li></ul><div class="help-tip">💡 Use pending transactions to plan future expenses without affecting the current balance.</div>`,
            es: `<div class="help-card-grid"><div class="help-mini-card"><strong>💰 Ingreso</strong>Dinero que entra</div><div class="help-mini-card"><strong>💸 Gasto</strong>Dinero que sale</div><div class="help-mini-card"><strong>🔄 Transferencia</strong>Entre sus propias cuentas</div></div><div class="help-tip">💡 Use transacciones pendientes para planificar gastos futuros.</div>`,
            fr: `<div class="help-card-grid"><div class="help-mini-card"><strong>💰 Revenu</strong>Argent entrant</div><div class="help-mini-card"><strong>💸 Dépense</strong>Argent sortant</div><div class="help-mini-card"><strong>🔄 Virement</strong>Entre vos propres comptes</div></div><div class="help-tip">💡 Utilisez les transactions en attente pour planifier des dépenses futures.</div>`,
          },
        },
        {
          id: 'tx-filters',
          title: { pt: 'Filtros e busca', en: 'Filters and search', es: 'Filtros y búsqueda', fr: 'Filtres et recherche' },
          body: {
            pt: `<h4>Filtros disponíveis</h4><ul><li><strong>Mês:</strong> filtre por mês/ano ou "Todos os meses"</li><li><strong>Conta:</strong> veja apenas uma conta específica</li><li><strong>Categoria:</strong> isole uma categoria de gastos</li><li><strong>Beneficiário:</strong> todas as transações com um pagador/recebedor</li><li><strong>Status:</strong> confirmadas, pendentes ou todas</li><li><strong>Tipo:</strong> receitas, despesas ou transferências</li></ul><h4>Busca por texto</h4><p>Use o campo de busca para localizar lançamentos pela descrição ou memo. A busca é instantânea e não diferencia maiúsculas/minúsculas.</p><div class="help-tip">💡 Combine filtros para análises precisas: "Despesas → Alimentação → Novembro".</div>`,
            en: `<h4>Available filters</h4><ul><li><strong>Month:</strong> filter by month/year or "All months"</li><li><strong>Account:</strong> view only one specific account</li><li><strong>Category:</strong> isolate a spending category</li><li><strong>Payee:</strong> all transactions with a payer/receiver</li><li><strong>Status:</strong> confirmed, pending or all</li><li><strong>Type:</strong> income, expenses or transfers</li></ul><div class="help-tip">💡 Combine filters for precise analysis: "Expense → Food → November".</div>`,
            es: `<ul><li><strong>Mes:</strong> filtrar por mes/año</li><li><strong>Cuenta:</strong> ver solo una cuenta</li><li><strong>Categoría:</strong> aislar una categoría</li><li><strong>Estado:</strong> confirmadas, pendientes o todas</li></ul><div class="help-tip">💡 Combine filtros para análisis precisos.</div>`,
            fr: `<ul><li><strong>Mois:</strong> filtrer par mois/année</li><li><strong>Compte:</strong> voir un seul compte</li><li><strong>Catégorie:</strong> isoler une catégorie</li><li><strong>Statut:</strong> confirmées, en attente ou toutes</li></ul><div class="help-tip">💡 Combinez les filtres pour des analyses précises.</div>`,
          },
        },
        {
          id: 'tx-reconcile',
          title: { pt: 'Reconciliação', en: 'Reconciliation', es: 'Conciliación', fr: 'Rapprochement' },
          body: {
            pt: `<p>A reconciliação permite conferir se seus lançamentos no app batem com o extrato bancário real.</p><ol><li>Ative o <strong>Modo Reconciliação</strong> na tela de Lançamentos</li><li>Marque cada lançamento que já aparece no extrato do banco</li><li>Compare o saldo reconciliado com o saldo real do banco</li><li>Finalize quando os saldos coincidirem</li></ol><div class="help-tip">💡 Reconcilie mensalmente para garantir que os saldos estão corretos.</div><div class="help-warning">⚠️ Lançamentos reconciliados ficam marcados com ✓REC e não devem ser editados.</div>`,
            en: `<p>Reconciliation lets you verify that your app transactions match your real bank statement.</p><ol><li>Enable <strong>Reconciliation Mode</strong> on the Transactions screen</li><li>Check each transaction that appears on your bank statement</li><li>Compare the reconciled balance with the real bank balance</li><li>Finalize when the balances match</li></ol><div class="help-tip">💡 Reconcile monthly to ensure balances are correct.</div>`,
            es: `<ol><li>Active el <strong>Modo Conciliación</strong> en la pantalla de Transacciones</li><li>Marque cada transacción que aparece en el extracto bancario</li><li>Compare el saldo conciliado con el saldo real del banco</li></ol>`,
            fr: `<ol><li>Activez le <strong>Mode rapprochement</strong> sur l'écran Transactions</li><li>Cochez chaque transaction qui apparaît sur votre relevé bancaire</li><li>Comparez le solde rapproché avec le solde bancaire réel</li></ol>`,
          },
        },
      ],
    },
    {
      id: 'categories', icon: '🏷️', color: '#7c3aed',
      title: { pt: 'Categorias', en: 'Categories', es: 'Categorías', fr: 'Catégories' },
      articles: [
        {
          id: 'categories-intro',
          title: { pt: 'Como usar categorias', en: 'How to use categories', es: 'Cómo usar categorías', fr: 'Comment utiliser les catégories' },
          body: {
            pt: `<p>Categorias organizam seus lançamentos e são fundamentais para análises precisas nos relatórios.</p><h4>Estrutura hierárquica</h4><p>O app suporta categorias pai e subcategorias. Exemplo: <strong>Alimentação</strong> → Supermercado, Restaurantes, Delivery.</p><h4>Tipos de categoria</h4><ul><li><strong>Despesa:</strong> para classificar gastos</li><li><strong>Receita:</strong> para classificar entradas de dinheiro</li></ul><h4>Categorias favoritas</h4><p>Marque as mais usadas como favoritas (⭐) para que apareçam em destaque no Dashboard.</p><div class="help-tip">💡 Mantenha 10–20 categorias para não complicar a classificação no dia a dia.</div>`,
            en: `<p>Categories organize your transactions and are essential for accurate report analysis.</p><h4>Hierarchical structure</h4><p>The app supports parent categories and subcategories. Example: <strong>Food</strong> → Supermarket, Restaurants, Delivery.</p><h4>Category types</h4><ul><li><strong>Expense:</strong> to classify spending</li><li><strong>Income:</strong> to classify money coming in</li></ul><h4>Favorite categories</h4><p>Mark the most-used categories as favorites (⭐) to have them highlighted in the Dashboard.</p><div class="help-tip">💡 Keep 10–20 categories to avoid complicating day-to-day classification.</div>`,
            es: `<p>Las categorías organizan sus transacciones.</p><h4>Estructura jerárquica</h4><p>La app admite categorías padre y subcategorías. Ej: <strong>Alimentación</strong> → Supermercado, Restaurantes.</p><h4>Tipos de categoría</h4><ul><li><strong>Gasto:</strong> para clasificar gastos</li><li><strong>Ingreso:</strong> para clasificar entradas</li></ul><div class="help-tip">💡 Mantenga 10–20 categorías para no complicar la clasificación.</div>`,
            fr: `<p>Les catégories organisent vos transactions.</p><h4>Structure hiérarchique</h4><p>L'app prend en charge catégories parentes et sous-catégories. Ex: <strong>Alimentation</strong> → Supermarché, Restaurants.</p><h4>Types</h4><ul><li><strong>Dépense:</strong> pour classer les dépenses</li><li><strong>Revenu:</strong> pour classer les revenus</li></ul>`,
          },
        },
      ],
    },
    {
      id: 'budgets', icon: '🎯', color: '#dc2626',
      title: { pt: 'Orçamentos', en: 'Budgets', es: 'Presupuestos', fr: 'Budgets' },
      articles: [
        {
          id: 'budgets-intro',
          title: { pt: 'Criando e gerenciando orçamentos', en: 'Creating and managing budgets', es: 'Crear y gestionar presupuestos', fr: 'Créer et gérer des budgets' },
          body: {
            pt: `<p>Orçamentos permitem definir um limite de gastos mensal por categoria e acompanhar quanto já foi utilizado.</p><h4>Como criar</h4><ol><li>Acesse <strong>Orçamentos</strong></li><li>Selecione o mês de referência</li><li>Clique em <strong>+ Novo Orçamento</strong></li><li>Escolha a categoria e defina o valor limite</li></ol><div class="help-card-grid"><div class="help-mini-card"><strong>🟢 Verde (0–80%)</strong>Dentro do orçamento</div><div class="help-mini-card"><strong>🟡 Amarelo (80–100%)</strong>Próximo do limite</div><div class="help-mini-card"><strong>🔴 Vermelho (>100%)</strong>Orçamento excedido</div></div><div class="help-warning">⚠️ Orçamentos não bloqueiam lançamentos — apenas alertam visualmente.</div>`,
            en: `<p>Budgets let you set a monthly spending limit for each category.</p><ol><li>Go to <strong>Budgets</strong></li><li>Select the reference month</li><li>Click <strong>+ New Budget</strong></li><li>Choose the category and set the limit amount</li></ol><div class="help-card-grid"><div class="help-mini-card"><strong>🟢 Green (0–80%)</strong>Within budget</div><div class="help-mini-card"><strong>🟡 Yellow (80–100%)</strong>Near the limit</div><div class="help-mini-card"><strong>🔴 Red (&gt;100%)</strong>Budget exceeded</div></div><div class="help-warning">⚠️ Budgets don't block transactions — they only provide a visual alert.</div>`,
            es: `<p>Los presupuestos permiten definir un límite de gasto mensual por categoría.</p><ol><li>Vaya a <strong>Presupuestos</strong></li><li>Seleccione el mes de referencia</li><li>Haga clic en <strong>+ Nuevo presupuesto</strong></li><li>Elija la categoría y el monto límite</li></ol>`,
            fr: `<p>Les budgets permettent de définir une limite de dépenses mensuelle par catégorie.</p><ol><li>Allez dans <strong>Budgets</strong></li><li>Sélectionnez le mois de référence</li><li>Cliquez sur <strong>+ Nouveau budget</strong></li><li>Choisissez la catégorie et le montant limite</li></ol>`,
          },
        },
      ],
    },
    {
      id: 'scheduled', icon: '📅', color: '#d97706',
      title: { pt: 'Programados', en: 'Scheduled', es: 'Programados', fr: 'Programmés' },
      articles: [
        {
          id: 'scheduled-intro',
          title: { pt: 'Lançamentos recorrentes', en: 'Recurring transactions', es: 'Transacciones recurrentes', fr: 'Transactions récurrentes' },
          body: {
            pt: `<p>Lançamentos programados automatizam o registro de transações que se repetem: aluguel, salário, assinaturas, parcelas.</p><h4>Como criar</h4><ol><li>Acesse <strong>Programados</strong></li><li>Clique em <strong>+ Novo Programado</strong></li><li>Preencha os dados (tipo, valor, conta, categoria)</li><li>Defina a frequência: Diário, Semanal, Mensal, Anual…</li><li>Configure a data de início e, opcionalmente, a data de fim</li></ol><div class="help-card-grid"><div class="help-mini-card"><strong>Ativo</strong>Será registrado nas datas previstas</div><div class="help-mini-card"><strong>Atrasado</strong>Data passou e não foi registrado</div><div class="help-mini-card"><strong>Concluído</strong>Ciclo encerrado</div></div><div class="help-tip">💡 Use "Avisar com antecedência" para alertas antes do vencimento.</div>`,
            en: `<p>Scheduled transactions automate the registration of repeating transactions: rent, salary, subscriptions, installments.</p><ol><li>Go to <strong>Scheduled</strong></li><li>Click <strong>+ New Scheduled</strong></li><li>Fill in the details (type, amount, account, category)</li><li>Set the frequency: Daily, Weekly, Monthly, Annual…</li><li>Set the start date and optionally the end date</li></ol><div class="help-card-grid"><div class="help-mini-card"><strong>Active</strong>Will be registered on scheduled dates</div><div class="help-mini-card"><strong>Overdue</strong>Date passed without registration</div><div class="help-mini-card"><strong>Completed</strong>Cycle ended</div></div><div class="help-tip">💡 Use "Notify in advance" for alerts before due dates.</div>`,
            es: `<p>Las transacciones programadas automatizan el registro de transacciones recurrentes.</p><ol><li>Vaya a <strong>Programados</strong></li><li>Haga clic en <strong>+ Nuevo programado</strong></li><li>Complete los datos y defina la frecuencia</li></ol>`,
            fr: `<p>Les transactions programmées automatisent l'enregistrement des transactions récurrentes.</p><ol><li>Allez dans <strong>Programmés</strong></li><li>Cliquez sur <strong>+ Nouveau programmé</strong></li><li>Remplissez les détails et définissez la fréquence</li></ol>`,
          },
        },
      ],
    },
    {
      id: 'reports', icon: '📊', color: '#0284c7',
      title: { pt: 'Relatórios', en: 'Reports', es: 'Informes', fr: 'Rapports' },
      articles: [
        {
          id: 'reports-intro',
          title: { pt: 'Visões de análise', en: 'Analysis views', es: 'Vistas de análisis', fr: "Vues d'analyse" },
          body: {
            pt: `<div class="help-card-grid"><div class="help-mini-card"><strong>📊 Análise</strong>Gráficos de distribuição por categoria, conta e tendência mensal</div><div class="help-mini-card"><strong>💳 Transações</strong>Tabela filtrável de todos os lançamentos do período</div><div class="help-mini-card"><strong>🔮 Previsão</strong>Fluxo de caixa projetado com programados</div></div><h4>Filtros do relatório</h4><ul><li><strong>Período:</strong> mês atual, trimestre, ano ou personalizado</li><li><strong>Conta, Categoria, Beneficiário, Tipo</strong></li></ul><h4>Gráfico de categorias</h4><p>Visualize como <strong>barras horizontais</strong> (padrão) ou <strong>rosca</strong>. Alterne entre Despesas e Receitas com os botões no topo do card.</p><h4>Exportação</h4><ul><li><strong>PDF:</strong> relatório completo com gráficos</li><li><strong>CSV:</strong> dados brutos para Excel/Sheets</li></ul><div class="help-tip">💡 Use "Últimos 12 meses" para ver tendências anuais.</div>`,
            en: `<div class="help-card-grid"><div class="help-mini-card"><strong>📊 Analysis</strong>Distribution charts by category, account and monthly trend</div><div class="help-mini-card"><strong>💳 Transactions</strong>Filterable table of all period transactions</div><div class="help-mini-card"><strong>🔮 Forecast</strong>Projected cash flow with scheduled transactions</div></div><h4>Report filters</h4><ul><li><strong>Period:</strong> current month, quarter, year or custom</li><li><strong>Account, Category, Payee, Type</strong></li></ul><h4>Category chart</h4><p>View as <strong>horizontal bars</strong> (default) or <strong>donut</strong>. Toggle between Expenses and Income with the buttons at the top of the card.</p><div class="help-tip">💡 Use "Last 12 months" to see annual trends.</div>`,
            es: `<div class="help-card-grid"><div class="help-mini-card"><strong>📊 Análisis</strong>Gráficos de distribución</div><div class="help-mini-card"><strong>💳 Transacciones</strong>Tabla filtrable</div><div class="help-mini-card"><strong>🔮 Previsión</strong>Flujo de caja proyectado</div></div><h4>Exportación</h4><ul><li><strong>PDF:</strong> informe completo con gráficos</li><li><strong>CSV:</strong> datos para Excel/Sheets</li></ul>`,
            fr: `<div class="help-card-grid"><div class="help-mini-card"><strong>📊 Analyse</strong>Graphiques de distribution</div><div class="help-mini-card"><strong>💳 Transactions</strong>Tableau filtrable</div><div class="help-mini-card"><strong>🔮 Prévision</strong>Trésorerie projetée</div></div><h4>Exportation</h4><ul><li><strong>PDF:</strong> rapport complet avec graphiques</li><li><strong>CSV:</strong> données pour Excel/Sheets</li></ul>`,
          },
        },
        {
          id: 'reports-forecast',
          title: { pt: 'Previsão de fluxo de caixa', en: 'Cash flow forecast', es: 'Previsión de flujo de caja', fr: 'Prévision de trésorerie' },
          body: {
            pt: `<p>Mostra como o saldo das suas contas vai evoluir, considerando lançamentos programados.</p><ol><li>Selecione o período de previsão</li><li>Escolha as contas a incluir</li><li>O app combina lançamentos reais com os programados futuros</li><li>O gráfico e a tabela mostram o saldo dia a dia</li></ol><ul><li>Linhas normais = transações já confirmadas</li><li>Linhas com <em>prog.</em> = lançamentos programados futuros</li><li>Saldo negativo aparece em vermelho</li></ul><div class="help-tip">💡 Use a previsão para identificar meses críticos onde o saldo pode ficar negativo.</div>`,
            en: `<p>Shows how your account balances will evolve, considering scheduled transactions.</p><ol><li>Select the forecast period</li><li>Choose which accounts to include</li><li>The app combines real transactions with future scheduled ones</li><li>The chart and table show the balance day by day</li></ol><div class="help-tip">💡 Use the forecast to identify critical months where the balance might go negative.</div>`,
            es: `<p>Muestra cómo evolucionarán los saldos de sus cuentas considerando las transacciones programadas.</p><ol><li>Seleccione el período de previsión</li><li>Elija las cuentas a incluir</li><li>La app combina transacciones reales con las programadas futuras</li></ol>`,
            fr: `<p>Montre comment les soldes évolueront en tenant compte des transactions programmées.</p><ol><li>Sélectionnez la période de prévision</li><li>Choisissez les comptes à inclure</li><li>L'app combine transactions réelles et futures programmées</li></ol>`,
          },
        },
      ],
    },
    {
      id: 'ai-insights', icon: '🤖', color: '#7c3aed',
      title: { pt: 'AI Insights', en: 'AI Insights', es: 'Perspectivas IA', fr: 'Aperçus IA' },
      articles: [
        {
          id: 'ai-intro',
          title: { pt: 'Análise inteligente com IA', en: 'Smart AI analysis', es: 'Análisis inteligente con IA', fr: "Analyse intelligente avec l'IA" },
          body: {
            pt: `<p>O <strong>AI Insights</strong> usa inteligência artificial para analisar seus dados financeiros e fornecer insights personalizados, recomendações e alertas — tudo em linguagem natural.</p><h4>Aba Análise</h4><p>Selecione o período e clique em <strong>Analisar</strong>. Os resultados incluem:</p><ul><li>Resumo do período em linguagem natural</li><li>Análise por categoria e beneficiário</li><li>Gastos por membro da família com detalhamento</li><li>Oportunidades de economia e recomendações</li><li>Alertas de fluxo de caixa</li></ul><h4>Aba Chat</h4><p>Faça perguntas sobre suas finanças em linguagem natural: <em>"Qual foi meu maior gasto em março?"</em>, <em>"Em que posso economizar?"</em>, <em>"Compare meus gastos com alimentação nos últimos 3 meses."</em></p><div class="help-tip">💡 A IA usa dados já computados pelo app — garantindo precisão em todos os valores apresentados.</div>`,
            en: `<p><strong>AI Insights</strong> uses artificial intelligence to analyze your financial data and provide personalized insights, recommendations and alerts — all in natural language.</p><h4>Analysis tab</h4><p>Select the period and click <strong>Analyze</strong>. Results include:</p><ul><li>Period summary in natural language</li><li>Analysis by category and payee</li><li>Family member expenses with detailed breakdown</li><li>Savings opportunities and recommendations</li><li>Cash flow alerts</li></ul><h4>Chat tab</h4><p>Ask questions about your finances in natural language: <em>"What was my biggest expense in March?"</em>, <em>"Where can I save money?"</em>, <em>"Compare my food spending over the last 3 months."</em></p><div class="help-tip">💡 The AI uses data already computed by the app — ensuring accurate values throughout.</div>`,
            es: `<p><strong>AI Insights</strong> utiliza inteligencia artificial para analizar sus datos financieros y proporcionar insights personalizados, recomendaciones y alertas en lenguaje natural.</p><h4>Pestaña Análisis</h4><p>Seleccione el período y haga clic en <strong>Analizar</strong>. Los resultados incluyen análisis por categoría, gastos por miembro y oportunidades de ahorro.</p><h4>Pestaña Chat</h4><p>Haga preguntas como: <em>"¿Cuál fue mi mayor gasto en marzo?"</em>, <em>"¿En qué puedo ahorrar?"</em></p><div class="help-tip">💡 La IA usa datos ya calculados por la app, garantizando precisión en todos los valores.</div>`,
            fr: `<p><strong>AI Insights</strong> utilise l'intelligence artificielle pour analyser vos données financières et fournir des insights personnalisés, recommandations et alertes en langage naturel.</p><h4>Onglet Analyse</h4><p>Sélectionnez la période et cliquez sur <strong>Analyser</strong>. Les résultats comprennent une analyse par catégorie, les dépenses par membre et les opportunités d'économies.</p><h4>Onglet Chat</h4><p>Posez des questions comme : <em>"Quelle a été ma plus grande dépense en mars ?"</em>, <em>"Où puis-je économiser ?"</em></p><div class="help-tip">💡 L'IA utilise des données déjà calculées par l'app, garantissant la précision des valeurs.</div>`,
          },
        },
      ],
    },
    {
      id: 'import', icon: '📥', color: '#64748b',
      title: { pt: 'Importação e Backup', en: 'Import & Backup', es: 'Importación y respaldo', fr: 'Import et sauvegarde' },
      articles: [
        {
          id: 'import-intro',
          title: { pt: 'Importar extratos bancários', en: 'Import bank statements', es: 'Importar extractos bancarios', fr: 'Importer des relevés bancaires' },
          body: {
            pt: `<p>Importe lançamentos em massa via arquivo CSV ou OFX diretamente do seu banco.</p><div class="help-card-grid"><div class="help-mini-card"><strong>CSV Genérico</strong>Mapeie as colunas manualmente</div><div class="help-mini-card"><strong>OFX/QFX</strong>Padrão bancário universal</div><div class="help-mini-card"><strong>Nubank</strong>Export automático do app</div><div class="help-mini-card"><strong>Itaú, Bradesco, Inter</strong>Formatos específicos</div></div><h4>Processo de importação</h4><ol><li>Acesse <strong>Importar / Backup</strong></li><li>Selecione o banco/formato</li><li>Faça upload do arquivo</li><li>Revise o mapeamento de colunas (se CSV)</li><li>Confira a prévia dos lançamentos</li><li>Confirme a importação</li></ol><div class="help-warning">⚠️ O app detecta lançamentos duplicados automaticamente. Revise sempre a prévia antes de confirmar.</div>`,
            en: `<p>Import transactions in bulk via CSV or OFX file directly from your bank.</p><div class="help-card-grid"><div class="help-mini-card"><strong>Generic CSV</strong>Map columns manually</div><div class="help-mini-card"><strong>OFX/QFX</strong>Universal banking standard</div><div class="help-mini-card"><strong>Nubank</strong>Automatic export from app</div><div class="help-mini-card"><strong>Various banks</strong>Specific formats</div></div><ol><li>Go to <strong>Import / Backup</strong></li><li>Select the bank/format</li><li>Upload the file</li><li>Review column mapping (if CSV)</li><li>Check the transaction preview</li><li>Confirm the import</li></ol><div class="help-warning">⚠️ The app automatically detects duplicate transactions. Always review before confirming.</div>`,
            es: `<p>Importe transacciones en masa mediante archivo CSV u OFX.</p><ol><li>Vaya a <strong>Importar / Respaldo</strong></li><li>Seleccione el banco/formato</li><li>Cargue el archivo y revise la vista previa</li></ol>`,
            fr: `<p>Importez des transactions en masse via CSV ou OFX.</p><ol><li>Allez dans <strong>Importer / Sauvegarde</strong></li><li>Sélectionnez la banque/format</li><li>Téléversez le fichier et vérifiez l'aperçu</li></ol>`,
          },
        },
        {
          id: 'backup',
          title: { pt: 'Backup e restauração', en: 'Backup and restore', es: 'Respaldo y restauración', fr: 'Sauvegarde et restauration' },
          body: {
            pt: `<h4>Backup manual</h4><ol><li>Acesse <strong>Importar / Backup → Backup</strong></li><li>Clique em <strong>Fazer Backup agora</strong></li><li>O arquivo JSON é gerado e pode ser baixado ou salvo no banco</li></ol><h4>Restaurar backup</h4><ol><li>Selecione o arquivo de backup (.json)</li><li>Revise o resumo do que será restaurado</li><li>Confirme — a restauração acrescenta dados, não apaga existentes</li></ol><div class="help-tip">💡 Faça backup antes de grandes importações ou alterações em massa.</div>`,
            en: `<h4>Manual backup</h4><ol><li>Go to <strong>Import / Backup → Backup</strong></li><li>Click <strong>Backup now</strong></li><li>The JSON file is generated and can be downloaded or saved to the database</li></ol><h4>Restore backup</h4><ol><li>Select the backup file (.json)</li><li>Review the restore summary</li><li>Confirm — restore adds data, it does not delete existing records</li></ol><div class="help-tip">💡 Back up before large imports or bulk changes.</div>`,
            es: `<ol><li>Vaya a <strong>Importar / Respaldo → Respaldo</strong></li><li>Haga clic en <strong>Hacer respaldo ahora</strong></li></ol>`,
            fr: `<ol><li>Allez dans <strong>Importer / Sauvegarde → Sauvegarde</strong></li><li>Cliquez sur <strong>Sauvegarder maintenant</strong></li></ol>`,
          },
        },
      ],
    },
    {
      id: 'settings', icon: '⚙️', color: '#475569',
      title: { pt: 'Configurações', en: 'Settings', es: 'Configuración', fr: 'Paramètres' },
      articles: [
        {
          id: 'settings-overview',
          title: { pt: 'Visão geral das configurações', en: 'Settings overview', es: 'Vista general de configuración', fr: "Vue d'ensemble des paramètres" },
          body: {
            pt: `<p>As configurações que você pode acessar dependem do seu papel na família. Estas são as configurações disponíveis para todos os usuários:</p><div class="help-card-grid"><div class="help-mini-card"><strong>👤 Perfil</strong>Seu nome, foto e idioma preferido</div><div class="help-mini-card"><strong>🎨 Aparência</strong>Escolha entre tema claro, escuro ou automático</div><div class="help-mini-card"><strong>🔒 Privacidade</strong>Modo privacidade para ocultar valores na tela</div><div class="help-mini-card"><strong>💾 Backup</strong>Exporte seus dados para segurança</div></div><h4>Módulos disponíveis</h4><p>O administrador da família pode ativar módulos extras. Verifique em <strong>Configurações → Módulos</strong> quais estão disponíveis para você:</p><ul><li><strong>🤖 AI Insights:</strong> análise inteligente das suas finanças</li><li><strong>🛒 Lista de Mercado:</strong> lista de compras integrada com preços</li><li><strong>💹 Investimentos:</strong> acompanhe sua carteira de ativos</li><li><strong>🏪 Gestão de Preços:</strong> catálogo de preços de produtos</li></ul>`,
            en: `<p>The settings you can access depend on your family role. These settings are available to all users:</p><div class="help-card-grid"><div class="help-mini-card"><strong>👤 Profile</strong>Your name, photo and preferred language</div><div class="help-mini-card"><strong>🎨 Appearance</strong>Choose light, dark or auto theme</div><div class="help-mini-card"><strong>🔒 Privacy</strong>Privacy mode to hide values on screen</div><div class="help-mini-card"><strong>💾 Backup</strong>Export your data for safety</div></div><h4>Available modules</h4><p>The family administrator can enable extra modules. Check <strong>Settings → Modules</strong> to see which are available to you:</p><ul><li><strong>🤖 AI Insights:</strong> intelligent analysis of your finances</li><li><strong>🛒 Grocery List:</strong> shopping list integrated with prices</li><li><strong>💹 Investments:</strong> track your asset portfolio</li><li><strong>🏪 Price Management:</strong> product price catalog</li></ul>`,
            es: `<p>La configuración accesible depende de su rol en la familia. Configuraciones disponibles para todos los usuarios:</p><div class="help-card-grid"><div class="help-mini-card"><strong>👤 Perfil</strong>Su nombre, foto e idioma preferido</div><div class="help-mini-card"><strong>🎨 Apariencia</strong>Tema claro, oscuro o automático</div><div class="help-mini-card"><strong>🔒 Privacidad</strong>Modo privacidad para ocultar valores</div><div class="help-mini-card"><strong>💾 Respaldo</strong>Exporte sus datos</div></div><h4>Módulos disponibles</h4><p>El administrador de la familia puede activar módulos adicionales. Verifique en <strong>Configuración → Módulos</strong>.</p>`,
            fr: `<p>Les paramètres accessibles dépendent de votre rôle dans la famille. Paramètres disponibles pour tous les utilisateurs :</p><div class="help-card-grid"><div class="help-mini-card"><strong>👤 Profil</strong>Votre nom, photo et langue préférée</div><div class="help-mini-card"><strong>🎨 Apparence</strong>Thème clair, sombre ou automatique</div><div class="help-mini-card"><strong>🔒 Confidentialité</strong>Mode confidentialité pour masquer les valeurs</div><div class="help-mini-card"><strong>💾 Sauvegarde</strong>Exportez vos données</div></div><h4>Modules disponibles</h4><p>L'administrateur de la famille peut activer des modules supplémentaires. Vérifiez dans <strong>Paramètres → Modules</strong>.</p>`,
          },
        },
        {
          id: 'settings-privacy',
          title: { pt: 'Privacidade e segurança', en: 'Privacy and security', es: 'Privacidad y seguridad', fr: 'Confidentialité et sécurité' },
          body: {
            pt: `<h4>Modo privacidade</h4><p>Ative o <strong>Modo Privacidade</strong> (ícone 👁️ no topo) para ocultar todos os valores financeiros da tela. Útil quando estiver em locais públicos ou compartilhando a tela.</p><h4>Seus dados são seguros</h4><p>Cada família acessa somente seus próprios dados. Nunca há cruzamento de informações entre famílias diferentes.</p><h4>Papéis de acesso na família</h4><p>Quem te convidou para a família definiu seu nível de acesso:</p><ul><li><strong>👤 Usuário:</strong> registra e visualiza lançamentos da família</li><li><strong>👁️ Visualizador:</strong> apenas visualiza — não cria lançamentos</li></ul><div class="help-tip">💡 Em caso de dúvida sobre seu nível de acesso, fale com o administrador da sua família.</div>`,
            en: `<h4>Privacy mode</h4><p>Activate <strong>Privacy Mode</strong> (👁️ icon at the top) to hide all financial values on screen. Useful in public places or when sharing your screen.</p><h4>Your data is secure</h4><p>Each family accesses only their own data. There is never any crossover of information between different families.</p><h4>Family access roles</h4><p>Whoever invited you to the family set your access level:</p><ul><li><strong>👤 User:</strong> records and views family transactions</li><li><strong>👁️ Viewer:</strong> view only — cannot create transactions</li></ul><div class="help-tip">💡 If you have questions about your access level, contact your family administrator.</div>`,
            es: `<h4>Modo privacidad</h4><p>Active el <strong>Modo privacidad</strong> (ícono 👁️) para ocultar todos los valores financieros en pantalla. Útil en lugares públicos.</p><h4>Sus datos están seguros</h4><p>Cada familia accede únicamente a sus propios datos, sin cruce de información entre familias.</p><h4>Roles de acceso en la familia</h4><ul><li><strong>👤 Usuario:</strong> registra y visualiza transacciones</li><li><strong>👁️ Visualizador:</strong> solo visualización</li></ul><div class="help-tip">💡 Para dudas sobre su nivel de acceso, contacte al administrador de su familia.</div>`,
            fr: `<h4>Mode confidentialité</h4><p>Activez le <strong>Mode confidentialité</strong> (icône 👁️) pour masquer toutes les valeurs financières à l'écran. Utile dans les lieux publics.</p><h4>Vos données sont sécurisées</h4><p>Chaque famille accède uniquement à ses propres données, sans croisement d'informations entre familles.</p><h4>Rôles d'accès dans la famille</h4><ul><li><strong>👤 Utilisateur :</strong> enregistre et visualise les transactions</li><li><strong>👁️ Lecteur :</strong> visualisation uniquement</li></ul><div class="help-tip">💡 Pour toute question sur votre niveau d'accès, contactez l'administrateur de votre famille.</div>`,
          },
        },
      ],
    },
    {
      id: 'tips', icon: '💡', color: '#f59e0b',
      title: { pt: 'Dicas e Boas Práticas', en: 'Tips & Best Practices', es: 'Consejos y buenas prácticas', fr: 'Conseils et bonnes pratiques' },
      articles: [
        {
          id: 'tips-daily',
          title: { pt: 'Rotina financeira eficiente', en: 'Efficient financial routine', es: 'Rutina financiera eficiente', fr: 'Routine financière efficace' },
          body: {
            pt: `<h4>Rotina recomendada</h4><ul><li><strong>Diário (2 min):</strong> registre lançamentos do dia enquanto estão frescos na memória</li><li><strong>Semanal (5 min):</strong> revise lançamentos pendentes e confirme pagamentos realizados</li><li><strong>Mensal (15 min):</strong> reconcilie as contas, revise orçamentos e analise relatórios</li></ul><h4>Atalhos úteis</h4><ul><li>Botão <strong>+</strong> no Dashboard cria um lançamento rapidamente</li><li>Clique em uma transação para ver e editar detalhes</li><li>Use a busca para encontrar qualquer lançamento por palavra-chave</li></ul><h4>Fotografe seus recibos</h4><p>Ao criar uma transação, você pode anexar uma foto do recibo. O AI Insights pode ler automaticamente o recibo e preencher os campos.</p><div class="help-tip">💡 Ative o <strong>AI Insights</strong> para que a IA leia recibos e preencha automaticamente os campos do lançamento.</div>`,
            en: `<h4>Recommended routine</h4><ul><li><strong>Daily (2 min):</strong> record the day's transactions while fresh in memory</li><li><strong>Weekly (5 min):</strong> review pending transactions and confirm completed payments</li><li><strong>Monthly (15 min):</strong> reconcile accounts, review budgets and analyze reports</li></ul><h4>Useful shortcuts</h4><ul><li>The <strong>+</strong> button on the Dashboard quickly creates a transaction</li><li>Click a transaction to view and edit details</li><li>Use search to find any transaction by keyword</li></ul><h4>Photograph receipts</h4><p>When creating a transaction, you can attach a receipt photo. AI Insights can automatically read the receipt and fill in the fields.</p>`,
            es: `<h4>Rutina recomendada</h4><ul><li><strong>Diario (2 min):</strong> registre las transacciones del día</li><li><strong>Semanal (5 min):</strong> revise transacciones pendientes</li><li><strong>Mensual (15 min):</strong> concilie cuentas y analice informes</li></ul>`,
            fr: `<h4>Routine recommandée</h4><ul><li><strong>Quotidien (2 min):</strong> enregistrez les transactions du jour</li><li><strong>Hebdomadaire (5 min):</strong> révisez les transactions en attente</li><li><strong>Mensuel (15 min):</strong> rapprochez les comptes et analysez les rapports</li></ul>`,
          },
        },
        {
          id: 'tips-faq',
          title: { pt: 'Perguntas frequentes', en: 'Frequently asked questions', es: 'Preguntas frecuentes', fr: 'Questions fréquentes' },
          body: {
            pt: `<h4>Como corrigir o saldo de uma conta?</h4><p>Crie um lançamento do tipo "Ajuste de saldo" ou vá em <strong>Contas → Editar conta</strong> e ajuste o saldo inicial.</p><h4>Posso usar o app em vários dispositivos?</h4><p>Sim! Os dados ficam na nuvem e sincronizam automaticamente. Acesse de qualquer dispositivo com o mesmo login.</p><h4>Como convidar um familiar?</h4><p>Vá em seu avatar → <strong>Gerenciar minha família</strong> → adicione o membro e convide pelo e-mail.</p><h4>Como mudar o idioma?</h4><p>Clique no ícone 🌐 no menu superior, ou vá em <strong>Meu Perfil → Idioma</strong> e salve.</p><h4>Não consigo ver uma funcionalidade. O que fazer?</h4><p>Alguns módulos são ativados pelo administrador da família. Se não encontrar uma seção, entre em contato com quem gerencia sua família no app.</p><div class="help-tip">💡 Não encontrou sua dúvida? Use a busca no topo desta Central de Ajuda.</div>`,
            en: `<h4>How to correct an account balance?</h4><p>Create a "Balance adjustment" transaction or go to <strong>Accounts → Edit account</strong> and adjust the opening balance.</p><h4>Can I use the app on multiple devices?</h4><p>Yes! Data is stored in the cloud and syncs automatically. Access from any device with the same login.</p><h4>How to invite a family member?</h4><p>Go to your avatar → <strong>Manage my family</strong> → add the member and invite by email.</p><h4>How to change the language?</h4><p>Click the 🌐 icon in the top menu, or go to <strong>My Profile → Language</strong> and save.</p><h4>I can't see a feature. What should I do?</h4><p>Some modules are activated by the family administrator. If you can't find a section, contact whoever manages your family in the app.</p><div class="help-tip">💡 Can't find your answer? Use the search at the top of this Help Center.</div>`,
            es: `<h4>¿Cómo corregir el saldo de una cuenta?</h4><p>Cree una transacción de "Ajuste de saldo" o vaya a <strong>Cuentas → Editar cuenta</strong> y ajuste el saldo inicial.</p><h4>¿Puedo usar la app en varios dispositivos?</h4><p>¡Sí! Los datos se almacenan en la nube y se sincronizan automáticamente.</p><h4>¿Cómo cambiar el idioma?</h4><p>Haga clic en el ícono 🌐 en el menú superior.</p><h4>No encuentro una funcionalidad. ¿Qué hago?</h4><p>Algunos módulos son activados por el administrador de la familia. Contacte a quien gestiona su familia en la app.</p><div class="help-tip">💡 ¿No encontró su duda? Use la búsqueda en la parte superior.</div>`,
            fr: `<h4>Comment corriger le solde d'un compte?</h4><p>Créez une transaction "Ajustement de solde" ou allez dans <strong>Comptes → Modifier le compte</strong>.</p><h4>Puis-je utiliser l'app sur plusieurs appareils?</h4><p>Oui ! Les données sont dans le cloud et se synchronisent automatiquement.</p><h4>Comment changer la langue?</h4><p>Cliquez sur l'icône 🌐 dans le menu supérieur.</p><h4>Je ne trouve pas une fonctionnalité. Que faire?</h4><p>Certains modules sont activés par l'administrateur de la famille. Contactez la personne qui gère votre famille dans l'app.</p><div class="help-tip">💡 Vous ne trouvez pas votre réponse ? Utilisez la recherche en haut.</div>`,
          },
        },
      ],
    },
  ];
}

// ══════════════════════════════════════════════════════════════════════════
//  RENDER ENGINE
// ══════════════════════════════════════════════════════════════════════════

function initHelpPage() {
  const page = document.getElementById('page-help');
  if (!page) return;

  page.innerHTML = `
    <div class="help-shell">
      <nav class="help-nav" id="helpNavPanel">
        <div class="help-nav-header">
          <div class="help-nav-title">❓ ${_ht({pt:'Central de Ajuda',en:'Help Center',es:'Centro de ayuda',fr:"Centre d'aide"})}</div>
          <div style="position:relative;margin-top:8px">
            <input type="text" id="helpSearchInput" class="help-search"
              placeholder="${_ht({pt:'Buscar…',en:'Search…',es:'Buscar…',fr:'Rechercher…'})}"
              oninput="helpSearch(this.value)" autocomplete="off">
            <button id="helpSearchClear" onclick="document.getElementById('helpSearchInput').value='';helpSearch('')"
              style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer">✕</button>
            <div id="helpSearchResults" class="help-search-results" style="display:none"></div>
          </div>
        </div>
        <div class="help-nav-sections" id="helpNavSections"></div>
      </nav>
      <main class="help-content" id="helpContent">
        <button class="help-back-btn" id="helpBackBtn" onclick="helpShowHome()">
          ← ${_ht({pt:'Início',en:'Home',es:'Inicio',fr:'Accueil'})}
        </button>
        <div id="helpMain"></div>
      </main>
    </div>`;

  _helpRenderNav();
  helpShowHome();

  // Mobile: tap nav header to expand/collapse
  const navHeader = document.querySelector('.help-nav-header');
  if (navHeader) {
    navHeader.addEventListener('click', () => {
      const nav = document.querySelector('.help-nav');
      if (window.innerWidth <= 700 && nav) {
        nav.classList.toggle('expanded');
      }
    });
  }
}

// Collapse nav after selecting an article on mobile
function _helpCollapseNavMobile() {
  if (window.innerWidth <= 700) {
    const nav = document.querySelector('.help-nav');
    if (nav) nav.classList.remove('expanded');
  }
}

function _helpRenderNav() {
  const sections = _helpContent();
  const nav = document.getElementById('helpNavSections');
  if (!nav) return;
  nav.innerHTML = sections.map(s => `
    <div>
      <button class="help-nav-section-btn" onclick="helpShowSection('${s.id}')" id="helpNavBtn-${s.id}">
        <span class="help-nav-icon" style="background:${s.color}22;color:${s.color}">${s.icon}</span>
        <span class="help-nav-label">${_ht(s.title)}</span>
        <span class="help-nav-arr" id="helpNavArr-${s.id}">›</span>
      </button>
      <div class="help-nav-articles" id="helpNavArts-${s.id}" style="display:none">
        ${s.articles.map(a => `<button class="help-nav-article" onclick="helpShowArticle('${s.id}','${a.id}')" id="helpNavArt-${s.id}-${a.id}">${_ht(a.title)}</button>`).join('')}
      </div>
    </div>`).join('');
}

function helpShowHome() {
  const sections = _helpContent();
  _help.currentSection = null; _help.currentArticle = null;

  sections.forEach(s => {
    document.getElementById(`helpNavBtn-${s.id}`)?.classList.remove('active');
    const ap = document.getElementById(`helpNavArts-${s.id}`);
    if (ap) ap.style.display = 'none';
  });
  const backBtn = document.getElementById('helpBackBtn');
  if (backBtn) backBtn.style.display = 'none';

  // ── All multilingual copy ───────────────────────────────────────────────────
  const C = {
    tagline:    { pt:'Controle financeiro feito para sua família', en:'Financial control made for your family', es:'Control financiero hecho para su familia', fr:'Contrôle financier conçu pour votre famille' },
    sub:        { pt:'Acompanhe receitas, despesas, investimentos e orçamentos de toda a família — com inteligência, clareza e em qualquer idioma.', en:'Track income, expenses, investments and budgets for your whole family — with intelligence, clarity and in any language.', es:'Siga ingresos, gastos, inversiones y presupuestos de toda su familia — con inteligencia, claridad y en cualquier idioma.', fr:'Suivez revenus, dépenses, investissements et budgets de toute votre famille — avec intelligence, clarté et dans n\'importe quelle langue.' },
    cta:        { pt:'Explorar a documentação', en:'Explore the docs', es:'Explorar la documentación', fr:'Explorer la documentation' },
    ctaSub:     { pt:'Primeiros passos →', en:'Getting started →', es:'Primeros pasos →', fr:'Premiers pas →' },
    whyTitle:   { pt:'Por que escolher o FinTrack?', en:'Why choose FinTrack?', es:'¿Por qué elegir FinTrack?', fr:'Pourquoi choisir FinTrack?' },
    journeyTitle:{ pt:'Sua jornada financeira, passo a passo', en:'Your financial journey, step by step', es:'Su camino financiero, paso a paso', fr:'Votre parcours financier, étape par étape' },
    docsTitle:  { pt:'Documentação completa', en:'Complete documentation', es:'Documentación completa', fr:'Documentation complète' },
    tipLabel:   { pt:'Dica do dia', en:'Tip of the day', es:'Consejo del día', fr:'Conseil du jour' },
    tipMore:    { pt:'Ver todas as dicas →', en:'See all tips →', es:'Ver todos los consejos →', fr:'Voir tous les conseils →' },
    langTitle:  { pt:'Disponível nos seus idiomas', en:'Available in your languages', es:'Disponible en sus idiomas', fr:'Disponible dans vos langues' },
    langSub:    { pt:'Todo o conteúdo — app e ajuda — em Português, English, Español e Français. Mude em qualquer momento.', en:'All content — app and help — in Portuguese, English, Spanish and French. Switch at any time.', es:'Todo el contenido — app y ayuda — en Portugués, English, Español y Français. Cambie en cualquier momento.', fr:'Tout le contenu — app et aide — en Portugais, English, Español et Français. Changez à tout moment.' },
    arts:       { pt:'artigos', en:'articles', es:'artículos', fr:'articles' },
  };

  // ── Why-cards ────────────────────────────────────────────────────────────────
  const whyCards = [
    { icon:'💡', color:'#f59e0b', bg:'#fffbeb',
      title:{ pt:'Simples de usar', en:'Simple to use', es:'Fácil de usar', fr:'Simple à utiliser' },
      text:{ pt:'Interface intuitiva para toda a família — jovens, adultos e idosos navegam sem treinamento.', en:'Intuitive interface for the whole family — young, adults and seniors navigate without training.', es:'Interfaz intuitiva para toda la familia — jóvenes, adultos y mayores navegan sin capacitación.', fr:'Interface intuitive pour toute la famille — jeunes, adultes et seniors naviguent sans formation.' }},
    { icon:'🔒', color:'#2563eb', bg:'#eff6ff',
      title:{ pt:'Seus dados, sua segurança', en:'Your data, your security', es:'Sus datos, su seguridad', fr:'Vos données, votre sécurité' },
      text:{ pt:'Seus dados ficam na nuvem e cada família acessa somente o que é seu — nunca há cruzamento de informações.', en:'Your data is in the cloud and each family accesses only their own — there is never any crossover of information.', es:'Sus datos están en la nube y cada familia accede solo a lo suyo, sin cruce de información entre familias.', fr:"Vos données sont dans le cloud et chaque famille accède uniquement aux siennes — sans croisement d'informations." }},
    { icon:'🌍', color:'#16a34a', bg:'#f0fdf4',
      title:{ pt:'Multi-idiomas e multi-moedas', en:'Multi-language & multi-currency', es:'Multi-idioma y multi-divisa', fr:'Multi-langue et multi-devises' },
      text:{ pt:'Suporte completo a BRL, USD, EUR e qualquer moeda. Interface em PT, EN, ES e FR.', en:'Full support for BRL, USD, EUR and any currency. Interface in PT, EN, ES and FR.', es:'Soporte completo para BRL, USD, EUR y cualquier moneda. Interfaz en PT, EN, ES y FR.', fr:'Support complet BRL, USD, EUR et toute devise. Interface en PT, EN, ES et FR.' }},
    { icon:'📱', color:'#7c3aed', bg:'#faf5ff',
      title:{ pt:'Funciona em qualquer dispositivo', en:'Works on any device', es:'Funciona en cualquier dispositivo', fr:'Fonctionne sur n\'importe quel appareil' },
      text:{ pt:'PWA instalável no celular, tablet e computador. Dados sempre sincronizados na nuvem.', en:'PWA installable on phone, tablet and computer. Data always synced to the cloud.', es:'PWA instalable en móvil, tablet y computadora. Datos siempre sincronizados en la nube.', fr:'PWA installable sur téléphone, tablette et ordinateur. Données toujours synchronisées dans le cloud.' }},
  ];

  // ── Journey steps ────────────────────────────────────────────────────────────
  const journey = [
    { step:'1', icon:'🏦', color:'#0891b2',
      title:{ pt:'Cadastre suas contas', en:'Set up your accounts', es:'Configure sus cuentas', fr:'Configurez vos comptes' },
      desc:{ pt:'Adicione conta corrente, poupança, cartão e investimentos. Defina o saldo inicial.', en:'Add checking, savings, credit card and investments. Set the opening balance.', es:'Agregue cuenta corriente, ahorros, tarjeta e inversiones. Establezca el saldo inicial.', fr:'Ajoutez compte courant, épargne, carte et investissements. Définissez le solde initial.' },
      sec:'accounts', art:'accounts-types' },
    { step:'2', icon:'🏷️', color:'#7c3aed',
      title:{ pt:'Organize as categorias', en:'Organize categories', es:'Organice las categorías', fr:'Organisez les catégories' },
      desc:{ pt:'Crie categorias de despesas e receitas. Use hierarquia pai → filho para detalhamento.', en:'Create expense and income categories. Use parent → child hierarchy for detail.', es:'Cree categorías de gastos e ingresos. Use jerarquía padre → hijo para más detalle.', fr:'Créez des catégories de dépenses et revenus. Utilisez la hiérarchie parent → enfant.' },
      sec:'categories', art:'categories-intro' },
    { step:'3', icon:'💸', color:'#16a34a',
      title:{ pt:'Lance receitas e despesas', en:'Record income & expenses', es:'Registre ingresos y gastos', fr:'Enregistrez revenus et dépenses' },
      desc:{ pt:'Registre cada lançamento com conta, categoria e beneficiário. Anexe recibos em foto.', en:'Record each transaction with account, category and payee. Attach receipt photos.', es:'Registre cada transacción con cuenta, categoría y beneficiario. Adjunte fotos de recibos.', fr:'Enregistrez chaque transaction avec compte, catégorie et bénéficiaire. Joignez des photos.' },
      sec:'transactions', art:'tx-types' },
    { step:'4', icon:'🎯', color:'#dc2626',
      title:{ pt:'Defina orçamentos', en:'Set budgets', es:'Defina presupuestos', fr:'Définissez des budgets' },
      desc:{ pt:'Limite de gastos por categoria com alertas visuais ao se aproximar do teto.', en:'Spending limits per category with visual alerts when approaching the ceiling.', es:'Límite de gastos por categoría con alertas visuales al acercarse al tope.', fr:'Plafond de dépenses par catégorie avec alertes visuelles quand on s\'en approche.' },
      sec:'budgets', art:'budgets-intro' },
    { step:'5', icon:'📊', color:'#0284c7',
      title:{ pt:'Analise os relatórios', en:'Analyze reports', es:'Analice los informes', fr:'Analysez les rapports' },
      desc:{ pt:'Gráficos de distribuição, tendência mensal, previsão de caixa e exportação PDF/CSV.', en:'Distribution charts, monthly trend, cash flow forecast and PDF/CSV export.', es:'Gráficos de distribución, tendencia mensual, previsión de caja y exportación PDF/CSV.', fr:'Graphiques de distribution, tendance mensuelle, prévision de trésorerie et export PDF/CSV.' },
      sec:'reports', art:'reports-intro' },
    { step:'6', icon:'🤖', color:'#7c3aed',
      title:{ pt:'Ative a IA', en:'Activate AI', es:'Active la IA', fr:'Activez l\'IA' },
      desc:{ pt:'Converse com o Gemini sobre seus dados. Insights, recomendações e leitura automática de recibos.', en:'Chat with Gemini about your data. Insights, recommendations and automatic receipt reading.', es:'Converse con Gemini sobre sus datos. Insights, recomendaciones y lectura automática de recibos.', fr:'Discutez avec Gemini de vos données. Insights, recommandations et lecture automatique de reçus.' },
      sec:'ai-insights', art:'ai-intro' },
  ];

  // ── Rotating tips ────────────────────────────────────────────────────────────
  const tips = [
    { pt:'Reconcilie suas contas mensalmente. Leva 5 minutos e garante que nenhum lançamento foi esquecido.', en:'Reconcile your accounts monthly. It takes 5 minutes and ensures no transaction was missed.', es:'Concilie sus cuentas mensualmente. Tarda 5 minutos y garantiza que no se olvidó ninguna transacción.', fr:'Rapprochez vos comptes chaque mois. Cela prend 5 minutes et garantit qu\'aucune transaction n\'a été oubliée.' },
    { pt:'Use lançamentos Pendentes para planejar despesas futuras sem afetar o saldo atual.', en:'Use Pending transactions to plan future expenses without affecting your current balance.', es:'Use transacciones Pendientes para planificar gastos futuros sin afectar el saldo actual.', fr:'Utilisez les transactions En attente pour planifier des dépenses futures sans affecter votre solde.' },
    { pt:'Programe recorrências para aluguel, salário e assinaturas — o app lembra de você.', en:'Schedule recurring transactions for rent, salary and subscriptions — the app remembers for you.', es:'Programe recurrencias para alquiler, salario y suscripciones — la app lo recuerda por usted.', fr:'Programmez des récurrences pour loyer, salaire et abonnements — l\'app s\'en souvient pour vous.' },
    { pt:'O AI Insights analisa seu histórico e sugere onde você pode economizar dinheiro.', en:'AI Insights analyzes your history and suggests where you can save money.', es:'AI Insights analiza su historial y sugiere dónde puede ahorrar dinero.', fr:'AI Insights analyse votre historique et suggère où vous pouvez économiser de l\'argent.' },
    { pt:'Fotografe seus recibos ao criar um lançamento — o FinTrack guarda tudo digitalizado.', en:'Photograph your receipts when creating a transaction — FinTrack keeps everything digitized.', es:'Fotografíe sus recibos al crear una transacción — FinTrack guarda todo digitalizado.', fr:'Photographiez vos reçus lors de la création d\'une transaction — FinTrack garde tout numérisé.' },
    { pt:'Convide os membros da família. Cada um lança suas despesas e todos veem o quadro completo.', en:'Invite family members. Each one records their expenses and everyone sees the full picture.', es:'Invite a los miembros de la familia. Cada uno registra sus gastos y todos ven el panorama completo.', fr:'Invitez les membres de la famille. Chacun enregistre ses dépenses et tous voient le tableau complet.' },
  ];
  const tipIdx = new Date().getDate() % tips.length;

  // ── Language pills ────────────────────────────────────────────────────────────
  const langs = [
    { code:'pt', flag:'🇧🇷', name:'Português' },
    { code:'en', flag:'🇺🇸', name:'English' },
    { code:'es', flag:'🇪🇸', name:'Español' },
    { code:'fr', flag:'🇫🇷', name:'Français' },
  ];
  const curLang = (typeof i18nGetLanguage === 'function') ? i18nGetLanguage() : 'pt';

  // ── Build HTML ───────────────────────────────────────────────────────────────
  document.getElementById('helpMain').innerHTML = `
<div class="hh2-root">

  <!-- ══ HERO ══════════════════════════════════════════════════════════════ -->
  <div class="hh2-hero">
    <div class="hh2-hero-deco"></div>
    <div class="hh2-hero-inner">
      <div class="hh2-hero-badge">
        <span class="hh2-hero-badge-dot"></span>
        Family FinTrack
      </div>
      <h1 class="hh2-hero-title">${_ht(C.tagline)}</h1>
      <p class="hh2-hero-sub">${_ht(C.sub)}</p>
      <div class="hh2-hero-actions">
        <button class="hh2-cta-primary" onclick="helpShowArticle('getting-started','what-is')">
          ${_ht(C.cta)}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </button>
        <button class="hh2-cta-ghost" onclick="helpShowSection('getting-started')">${_ht(C.ctaSub)}</button>
      </div>
    </div>
    <div class="hh2-hero-modules">
      ${sections.slice(0,6).map(s => `
        <button class="hh2-module-pill" onclick="helpShowSection('${s.id}')" style="--mc:${s.color}">
          <span>${s.icon}</span>
          <span>${_ht(s.title)}</span>
        </button>`).join('')}
    </div>
  </div>

  <!-- ══ WHY SECTION ════════════════════════════════════════════════════════ -->
  <div class="hh2-section">
    <div class="hh2-section-header">
      <h2 class="hh2-section-title">${_ht(C.whyTitle)}</h2>
      <div class="hh2-section-line"></div>
    </div>
    <div class="hh2-why-grid">
      ${whyCards.map((w,i) => `
        <div class="hh2-why-card" style="--wc:${w.color};--wbg:${w.bg};animation-delay:${i*60}ms">
          <div class="hh2-why-icon">${w.icon}</div>
          <div class="hh2-why-title">${_ht(w.title)}</div>
          <div class="hh2-why-text">${_ht(w.text)}</div>
        </div>`).join('')}
    </div>
  </div>

  <!-- ══ JOURNEY ════════════════════════════════════════════════════════════ -->
  <div class="hh2-section">
    <div class="hh2-section-header">
      <h2 class="hh2-section-title">${_ht(C.journeyTitle)}</h2>
      <div class="hh2-section-line"></div>
    </div>
    <div class="hh2-journey">
      ${journey.map((j,i) => `
        <button class="hh2-journey-step" onclick="helpShowArticle('${j.sec}','${j.art}')" style="--jc:${j.color};animation-delay:${i*50}ms">
          <div class="hh2-journey-step-num" style="background:${j.color}">${j.step}</div>
          <div class="hh2-journey-icon" style="color:${j.color}">${j.icon}</div>
          <div class="hh2-journey-body">
            <div class="hh2-journey-title">${_ht(j.title)}</div>
            <div class="hh2-journey-desc">${_ht(j.desc)}</div>
          </div>
          <div class="hh2-journey-arr" style="color:${j.color}">›</div>
          ${i < journey.length - 1 ? '<div class="hh2-journey-connector"></div>' : ''}
        </button>`).join('')}
    </div>
  </div>

  <!-- ══ DOCS GRID ══════════════════════════════════════════════════════════ -->
  <div class="hh2-section">
    <div class="hh2-section-header">
      <h2 class="hh2-section-title">${_ht(C.docsTitle)}</h2>
      <div class="hh2-section-line"></div>
    </div>
    <div class="hh2-docs-grid">
      ${sections.map(s => `
        <button class="hh2-doc-card" onclick="helpShowSection('${s.id}')" style="--dc:${s.color}">
          <div class="hh2-doc-card-top">
            <span class="hh2-doc-icon">${s.icon}</span>
            <span class="hh2-doc-badge">${s.articles.length} ${_ht(C.arts)}</span>
          </div>
          <div class="hh2-doc-title">${_ht(s.title)}</div>
          <div class="hh2-doc-arts">
            ${s.articles.slice(0,2).map(a => `
              <div class="hh2-doc-art">
                <span class="hh2-doc-art-dot" style="background:${s.color}"></span>
                ${_ht(a.title)}
              </div>`).join('')}
            ${s.articles.length > 2 ? `<div class="hh2-doc-art hh2-doc-art-more" style="color:${s.color}">+ ${s.articles.length - 2} ${_ht(C.arts)}</div>` : ''}
          </div>
          <div class="hh2-doc-arrow" style="color:${s.color}">→</div>
        </button>`).join('')}
    </div>
  </div>

  <!-- ══ TIP ROTATIVO ═══════════════════════════════════════════════════════ -->
  <div class="hh2-section">
    <div class="hh2-tip-card" id="hh2TipCard">
      <div class="hh2-tip-left">
        <div class="hh2-tip-icon-wrap">
          <span class="hh2-tip-pulse"></span>
          💡
        </div>
        <div>
          <div class="hh2-tip-label">${_ht(C.tipLabel)}</div>
          <p class="hh2-tip-text" id="hh2TipText">${_ht(tips[tipIdx])}</p>
        </div>
      </div>
      <div class="hh2-tip-right">
        <div class="hh2-tip-dots" id="hh2TipDots">
          ${tips.map((_,i) => `<button class="hh2-tip-dot ${i===tipIdx?'active':''}" onclick="hh2SetTip(${i})" aria-label="Tip ${i+1}"></button>`).join('')}
        </div>
        <button class="hh2-tip-more" onclick="helpShowArticle('tips','tips-daily')">${_ht(C.tipMore)}</button>
      </div>
    </div>
  </div>

  <!-- ══ LANGUAGE STRIP ════════════════════════════════════════════════════ -->
  <div class="hh2-section">
    <div class="hh2-lang-strip">
      <div class="hh2-lang-copy">
        <div class="hh2-lang-title">${_ht(C.langTitle)}</div>
        <div class="hh2-lang-sub">${_ht(C.langSub)}</div>
      </div>
      <div class="hh2-lang-pills">
        ${langs.map(l => `
          <button class="hh2-lang-pill ${l.code===curLang?'active':''}"
                  onclick="if(typeof quickSetLang==='function')quickSetLang('${l.code}')"
                  title="${l.name}">
            <span class="hh2-lang-flag">${l.flag}</span>
            <span>${l.name}</span>
          </button>`).join('')}
      </div>
    </div>
  </div>

  <!-- ══ FOOTER ═════════════════════════════════════════════════════════════ -->
  <div class="hh2-footer">
    <div class="hh2-footer-logo">💰 Family FinTrack</div>
    <div class="hh2-footer-tagline">${_ht({ pt:'Gestão financeira para toda a família', en:'Financial management for the whole family', es:'Gestión financiera para toda la familia', fr:'Gestion financière pour toute la famille' })}</div>
  </div>

</div>`;

  // Tip rotation state
  window._hh2TipIdx = tipIdx;
  window._hh2Tips   = tips;
}

// Tip rotation controller
window.hh2SetTip = function(idx) {
  const tips  = window._hh2Tips;
  const text  = document.getElementById('hh2TipText');
  const dots  = document.getElementById('hh2TipDots');
  if (!tips || !text || !dots) return;
  window._hh2TipIdx = idx;
  // Fade out → update → fade in
  text.style.opacity = '0';
  text.style.transform = 'translateY(4px)';
  setTimeout(() => {
    text.textContent = _ht(tips[idx]);
    text.style.opacity = '1';
    text.style.transform = 'translateY(0)';
  }, 160);
  dots.querySelectorAll('.hh2-tip-dot').forEach((d,i) => d.classList.toggle('active', i===idx));
};

// Auto-rotate tip every 8s when help is visible
(function _hh2AutoRotate() {
  const interval = setInterval(() => {
    if (!document.getElementById('hh2TipCard')) { clearInterval(interval); return; }
    const tips = window._hh2Tips || [];
    if (!tips.length) return;
    const next = ((window._hh2TipIdx || 0) + 1) % tips.length;
    hh2SetTip(next);
  }, 8000);
})();


function helpShowSection(sectionId) {
  _helpCollapseNavMobile();
  const sections = _helpContent();
  const sec = sections.find(s => s.id === sectionId);
  if (!sec) return;
  _help.currentSection = sectionId; _help.currentArticle = null;
  sections.forEach(s => {
    document.getElementById(`helpNavBtn-${s.id}`)?.classList.remove('active');
    const ap = document.getElementById(`helpNavArts-${s.id}`); if (ap) ap.style.display = 'none';
  });
  document.getElementById(`helpNavBtn-${sectionId}`)?.classList.add('active');
  const artsP = document.getElementById(`helpNavArts-${sectionId}`); if (artsP) artsP.style.display = '';
  document.getElementById('helpBackBtn').style.display = 'flex';
  document.getElementById('helpMain').innerHTML = `
    <div class="help-article-wrap">
      <div class="help-breadcrumb">
        <button onclick="helpShowHome()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:.72rem;font-family:inherit">${_ht({pt:'Início',en:'Home',es:'Inicio',fr:'Accueil'})}</button>
        <span class="help-breadcrumb-sep">›</span>
        <span class="help-breadcrumb-sec" style="color:${sec.color}">${_ht(sec.title)}</span>
      </div>
      <h1 class="help-article-title" style="color:${sec.color}">${sec.icon} ${_ht(sec.title)}</h1>
      <div class="help-card-grid">
        ${sec.articles.map(a => `
          <button class="help-mini-card" style="cursor:pointer;text-align:left;border:none;font-family:inherit;width:100%"
                  onclick="helpShowArticle('${sectionId}','${a.id}')"
                  onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
            <strong>${_ht(a.title)}</strong>
            <span style="color:var(--accent);font-size:.75rem">${_ht({pt:'Ver →',en:'View →',es:'Ver →',fr:'Voir →'})}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

function helpShowArticle(sectionId, articleId) {
  _helpCollapseNavMobile();
  const sections = _helpContent();
  const sec = sections.find(s => s.id === sectionId);
  if (!sec) return;
  const art = sec.articles.find(a => a.id === articleId);
  if (!art) return;
  _help.currentSection = sectionId; _help.currentArticle = articleId;
  sections.forEach(s => {
    document.getElementById(`helpNavBtn-${s.id}`)?.classList.remove('active');
    const ap = document.getElementById(`helpNavArts-${s.id}`); if (ap) ap.style.display = 'none';
    s.articles.forEach(a => document.getElementById(`helpNavArt-${s.id}-${a.id}`)?.classList.remove('active'));
  });
  document.getElementById(`helpNavBtn-${sectionId}`)?.classList.add('active');
  const artsP = document.getElementById(`helpNavArts-${sectionId}`); if (artsP) artsP.style.display = '';
  document.getElementById(`helpNavArt-${sectionId}-${articleId}`)?.classList.add('active');
  document.getElementById('helpBackBtn').style.display = 'flex';
  const all = sections.flatMap(s => s.articles.map(a => ({secId:s.id,artId:a.id,title:_ht(a.title)})));
  const idx = all.findIndex(a => a.secId===sectionId && a.artId===articleId);
  const prev = idx > 0 ? all[idx-1] : null;
  const next = idx < all.length-1 ? all[idx+1] : null;
  document.getElementById('helpMain').innerHTML = `
    <div class="help-article-wrap">
      <div class="help-breadcrumb">
        <button onclick="helpShowHome()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:.72rem;font-family:inherit">${_ht({pt:'Início',en:'Home',es:'Inicio',fr:'Accueil'})}</button>
        <span class="help-breadcrumb-sep">›</span>
        <button onclick="helpShowSection('${sectionId}')" style="background:none;border:none;cursor:pointer;color:${sec.color};font-size:.72rem;font-weight:600;font-family:inherit">${_ht(sec.title)}</button>
        <span class="help-breadcrumb-sep">›</span>
        <span style="color:var(--text2);font-size:.72rem">${_ht(art.title)}</span>
      </div>
      <h1 class="help-article-title">${_ht(art.title)}</h1>
      <div class="help-article-body">${_ht(art.body)}</div>
      <div class="help-article-nav">
        ${prev ? `<button class="help-prev-next" onclick="helpShowArticle('${prev.secId}','${prev.artId}')">← ${_ht({pt:'Anterior',en:'Previous',es:'Anterior',fr:'Précédent'})}<br><span style="font-size:.72rem;color:var(--muted)">${prev.title}</span></button>` : '<span></span>'}
        ${next ? `<button class="help-prev-next help-next" onclick="helpShowArticle('${next.secId}','${next.artId}')">${_ht({pt:'Próximo',en:'Next',es:'Siguiente',fr:'Suivant'})} →<br><span style="font-size:.72rem;color:var(--muted)">${next.title}</span></button>` : ''}
      </div>
    </div>`;
  document.getElementById('helpContent')?.scrollTo({top:0,behavior:'smooth'});
}

function helpSearch(query) {
  const clear = document.getElementById('helpSearchClear');
  const results = document.getElementById('helpSearchResults');
  if (!results) return;
  _help.searchQuery = query.trim().toLowerCase();
  if (clear) clear.style.display = _help.searchQuery ? '' : 'none';
  if (!_help.searchQuery) { results.style.display = 'none'; return; }
  const sections = _helpContent();
  const hits = [];
  sections.forEach(sec => sec.articles.forEach(art => {
    const title = _ht(art.title).toLowerCase();
    const body  = (_ht(art.body)||'').replace(/<[^>]+>/g,' ').toLowerCase();
    if (title.includes(_help.searchQuery) || body.includes(_help.searchQuery)) hits.push({sec, art});
  }));
  results.style.display = '';
  results.innerHTML = !hits.length
    ? `<div class="help-search-empty">${_ht({pt:'Nenhum resultado.',en:'No results.',es:'Sin resultados.',fr:'Aucun résultat.'})}</div>`
    : hits.slice(0,8).map(h => `
        <button class="help-search-hit" onclick="helpShowArticle('${h.sec.id}','${h.art.id}');document.getElementById('helpSearchResults').style.display='none';document.getElementById('helpSearchInput').value=''">
          <span class="help-search-hit-sec">${h.sec.icon}</span>
          <span class="help-search-hit-title">${_ht(h.art.title)}</span>
          <span class="help-search-hit-sec-name">${_ht(h.sec.title)}</span>
        </button>`).join('');
}

document.addEventListener('click', e => {
  if (!e.target.closest('#helpSearchInput') && !e.target.closest('#helpSearchResults')) {
    const r = document.getElementById('helpSearchResults'); if (r) r.style.display = 'none';
  }
});

// Contextual help button
function helpBtn(sectionId, articleId) {
  return `<button onclick="navigate('help');setTimeout(()=>helpShowArticle('${sectionId}','${articleId}'),200)"
    class="help-ctx-btn" title="${_ht({pt:'Ajuda',en:'Help',es:'Ayuda',fr:'Aide'})}">?</button>`;
}

window.initHelpPage     = initHelpPage;
window.helpShowHome     = helpShowHome;
window.helpShowSection  = helpShowSection;
window.helpShowArticle  = helpShowArticle;
window.helpSearch       = helpSearch;
window.helpBtn          = helpBtn;


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
