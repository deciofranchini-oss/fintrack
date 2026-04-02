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
            pt: `_helpIntroCard('O que é uma conta financeira?','🏦','Uma <strong>conta financeira</strong> é o espelho digital de onde você guarda e movimenta seu dinheiro. Assim como no mundo real você tem uma conta no banco, uma carteira física ou uma poupança, no app cada uma dessas "carteiras" é representada por uma conta. <strong>Por que isso importa?</strong> Porque o saldo de cada conta reflete exatamente quanto dinheiro você tem disponível ali — e saber disso é o primeiro passo para não gastar mais do que ganha.','#0891b2') +
<p>As contas representam seus ativos financeiros reais.</p><div class="help-card-grid"><div class="help-mini-card"><strong>Corrente</strong>Movimentações do dia a dia</div><div class="help-mini-card"><strong>Poupança</strong>Reserva financeira com rendimento</div><div class="help-mini-card"><strong>Cartão de Crédito</strong>Acompanhe faturas e gastos</div><div class="help-mini-card"><strong>Investimentos</strong>Renda fixa, ações, FIIs</div><div class="help-mini-card"><strong>Dinheiro</strong>Carteira física em espécie</div><div class="help-mini-card"><strong>Outro</strong>Qualquer ativo não listado</div></div><h4>Moeda estrangeira</h4><p>Cada conta pode ter sua própria moeda (BRL, USD, EUR). Transações em moeda estrangeira são convertidas automaticamente para BRL.</p><div class="help-tip">💡 Mantenha o saldo inicial correto ao criar a conta para que o saldo atual seja preciso desde o primeiro dia.</div>`,
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
            pt: `_helpIntroCard('Por que registrar cada lançamento?','💸','Um <strong>lançamento financeiro</strong> é o registro de toda movimentação de dinheiro: quando entra (receita) ou quando sai (despesa). Parece trabalhoso, mas é o hábito que separa quem controla suas finanças de quem fica "sem saber para onde foi o dinheiro". <strong>Sem dados, não há controle.</strong> Com dados, você vê padrões, identifica desperdícios e toma decisões melhores.','#16a34a') +
<div class="help-card-grid"><div class="help-mini-card"><strong>💰 Receita</strong>Dinheiro que entra: salário, renda extra, reembolsos</div><div class="help-mini-card"><strong>💸 Despesa</strong>Dinheiro que sai: compras, contas, serviços</div><div class="help-mini-card"><strong>🔄 Transferência</strong>Movimentação entre suas próprias contas</div></div><h4>Status dos lançamentos</h4><ul><li><strong>Confirmado:</strong> lançamento efetivado, afeta o saldo da conta</li><li><strong>Pendente:</strong> previsto mas ainda não ocorrido (ex: boleto a vencer)</li></ul><div class="help-tip">💡 Use lançamentos pendentes para planejar gastos futuros sem afetar o saldo atual.</div><h4>Campos importantes</h4><ul><li><strong>Data:</strong> data real do lançamento ou da competência</li><li><strong>Valor:</strong> valor positivo — o sistema aplica o sinal conforme o tipo</li><li><strong>Categoria:</strong> classifica o lançamento para relatórios</li><li><strong>Beneficiário:</strong> quem recebeu ou pagou</li><li><strong>Memo:</strong> detalhes extras para referência futura</li></ul>`,
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
            pt: `_helpIntroCard('O que é e para que serve uma categoria?','🏷️','Categorias são os <strong>rótulos que dão sentido</strong> aos seus lançamentos. Sem elas, você sabe que gastou R$ 3.000 no mês — mas não sabe <em>onde</em>. Com elas, você descobre: R$ 800 em alimentação, R$ 600 em transporte, R$ 400 em lazer. Essa clareza é a base de qualquer planejamento financeiro sério. A hierarquia pai → filho (ex: Alimentação → Supermercado) permite análises tanto no macro quanto no detalhe.','#7c3aed') +
<p>Categorias organizam seus lançamentos e são fundamentais para análises precisas nos relatórios.</p><h4>Estrutura hierárquica</h4><p>O app suporta categorias pai e subcategorias. Exemplo: <strong>Alimentação</strong> → Supermercado, Restaurantes, Delivery.</p><h4>Tipos de categoria</h4><ul><li><strong>Despesa:</strong> para classificar gastos</li><li><strong>Receita:</strong> para classificar entradas de dinheiro</li></ul><h4>Categorias favoritas</h4><p>Marque as mais usadas como favoritas (⭐) para que apareçam em destaque no Dashboard.</p><div class="help-tip">💡 Mantenha 10–20 categorias para não complicar a classificação no dia a dia.</div>`,
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
            pt: `_helpIntroCard('O que é um orçamento e por que fazer um?','🎯','Um <strong>orçamento</strong> é uma promessa que você faz para si mesmo: "vou gastar no máximo X reais em Y durante este mês". É a ferramenta mais poderosa de educação financeira porque força você a ser intencional com o dinheiro — a decidir <em>antes</em> onde ele vai, em vez de descobrir <em>depois</em> onde foi. Estudos mostram que pessoas que usam orçamentos acumulam patrimônio significativamente mais rápido que as que não usam.','#dc2626') +
<p>Orçamentos permitem definir um limite de gastos mensal por categoria e acompanhar quanto já foi utilizado.</p><h4>Como criar</h4><ol><li>Acesse <strong>Orçamentos</strong></li><li>Selecione o mês de referência</li><li>Clique em <strong>+ Novo Orçamento</strong></li><li>Escolha a categoria e defina o valor limite</li></ol><div class="help-card-grid"><div class="help-mini-card"><strong>🟢 Verde (0–80%)</strong>Dentro do orçamento</div><div class="help-mini-card"><strong>🟡 Amarelo (80–100%)</strong>Próximo do limite</div><div class="help-mini-card"><strong>🔴 Vermelho (>100%)</strong>Orçamento excedido</div></div><div class="help-warning">⚠️ Orçamentos não bloqueiam lançamentos — apenas alertam visualmente.</div>`,
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
            pt: `_helpIntroCard('O que são lançamentos programados?','📅','<strong>Lançamentos programados</strong> representam seus compromissos financeiros regulares: aluguel, salário, Netflix, parcela do carro. São as certezas do seu mês — acontecem independente de você lembrar. Registrá-los antecipadamente tem dois superpoderes: (1) você nunca esquece uma conta, e (2) o app consegue <em>prever</em> o saldo futuro das suas contas, mostrando meses antes se você vai ficar no vermelho.','#d97706') +
<p>Lançamentos programados automatizam o registro de transações que se repetem: aluguel, salário, assinaturas, parcelas.</p><h4>Como criar</h4><ol><li>Acesse <strong>Programados</strong></li><li>Clique em <strong>+ Novo Programado</strong></li><li>Preencha os dados (tipo, valor, conta, categoria)</li><li>Defina a frequência: Diário, Semanal, Mensal, Anual…</li><li>Configure a data de início e, opcionalmente, a data de fim</li></ol><div class="help-card-grid"><div class="help-mini-card"><strong>Ativo</strong>Será registrado nas datas previstas</div><div class="help-mini-card"><strong>Atrasado</strong>Data passou e não foi registrado</div><div class="help-mini-card"><strong>Concluído</strong>Ciclo encerrado</div></div><div class="help-tip">💡 Use "Avisar com antecedência" para alertas antes do vencimento.</div>`,
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
            pt: `_helpIntroCard('Para que servem os relatórios financeiros?','📊','Dados sozinhos não ensinam nada — é preciso <strong>transformá-los em visão</strong>. Os relatórios fazem exatamente isso: pegam centenas de lançamentos e revelam padrões que seriam invisíveis de outra forma. O gráfico de categorias mostra onde o dinheiro realmente vai. A tendência mensal mostra se você está melhorando ou piorando ao longo do tempo. A previsão de caixa avisa antes que o saldo fique negativo. Use os relatórios pelo menos uma vez por mês.','#0284c7') +
<div class="help-card-grid"><div class="help-mini-card"><strong>📊 Análise</strong>Gráficos de distribuição por categoria, conta e tendência mensal</div><div class="help-mini-card"><strong>💳 Transações</strong>Tabela filtrável de todos os lançamentos do período</div><div class="help-mini-card"><strong>🔮 Previsão</strong>Fluxo de caixa projetado com programados</div></div><h4>Filtros do relatório</h4><ul><li><strong>Período:</strong> mês atual, trimestre, ano ou personalizado</li><li><strong>Conta, Categoria, Beneficiário, Tipo</strong></li></ul><h4>Gráfico de categorias</h4><p>Visualize como <strong>barras horizontais</strong> (padrão) ou <strong>rosca</strong>. Alterne entre Despesas e Receitas com os botões no topo do card.</p><h4>Exportação</h4><ul><li><strong>PDF:</strong> relatório completo com gráficos</li><li><strong>CSV:</strong> dados brutos para Excel/Sheets</li></ul><div class="help-tip">💡 Use "Últimos 12 meses" para ver tendências anuais.</div>`,
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
            pt: `_helpIntroCard('O que é AI Insights e como funciona?','🤖','O <strong>AI Insights</strong> conecta seus dados financeiros à inteligência artificial do Google Gemini para gerar análises que iriam levar horas para você fazer manualmente. A IA não apenas descreve o passado — ela identifica padrões, detecta anomalias, compara com histórico e projeta o futuro. <strong>Importante:</strong> a IA nunca inventa números. Ela analisa os dados que o app já calculou com precisão. Seu papel é <em>interpretar</em> e <em>recomendar</em>, não recalcular.','#6d28d9') +
<p>O <strong>AI Insights</strong> usa inteligência artificial para analisar seus dados financeiros e fornecer insights personalizados, recomendações e alertas — tudo em linguagem natural.</p><h4>Aba Análise</h4><p>Selecione o período e clique em <strong>Analisar</strong>. Os resultados incluem:</p><ul><li>Resumo do período em linguagem natural</li><li>Análise por categoria e beneficiário</li><li>Gastos por membro da família com detalhamento</li><li>Oportunidades de economia e recomendações</li><li>Alertas de fluxo de caixa</li></ul><h4>Aba Chat</h4><p>Faça perguntas sobre suas finanças em linguagem natural: <em>"Qual foi meu maior gasto em março?"</em>, <em>"Em que posso economizar?"</em>, <em>"Compare meus gastos com alimentação nos últimos 3 meses."</em></p><div class="help-tip">💡 A IA usa dados já computados pelo app — garantindo precisão em todos os valores apresentados.</div>`,
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
      id: 'investments', icon: '💹', color: '#2a6049',
      title: { pt: 'Investimentos', en: 'Investments', es: 'Inversiones', fr: 'Investissements' },
      articles: [
        {
          id: 'investments-activation',
          title: { pt: 'Ativando o módulo de Investimentos', en: 'Activating the Investments module', es: 'Activar el módulo de Inversiones', fr: "Activer le module Investissements" },
          body: {
            pt: `_helpIntroCard('Por que acompanhar investimentos?','💹','<strong>Investir</strong> é colocar dinheiro para trabalhar por você. Mas investimento sem acompanhamento é como plantar sem regar: você não sabe se está crescendo, murchando ou se foi roubado. Monitorar sua carteira permite que você saiba em tempo real seu <em>retorno real</em> (descontando o que pagou), compare com outras opções e tome decisões de aportar ou vender com base em dados reais — não em intuição.','#2a6049') +
<p>O módulo de Investimentos é opcional e deve ser ativado pelo <strong>administrador</strong> da família.</p><h4>Como ativar</h4><ol><li>Acesse <strong>Configurações → Módulos</strong></li><li>Ative a chave <strong>Investimentos</strong></li><li>O item <strong>Investimentos</strong> aparecerá no menu lateral</li></ol><h4>Pré-requisito: conta do tipo Investimentos</h4><p>Antes de registrar posições, crie ao menos uma conta do tipo <strong>Investimentos</strong> na tela de Contas. Essa conta será o "portfólio" que agrupa as posições.</p><div class="help-tip">💡 Você pode ter várias contas de investimento — por exemplo: uma para a bolsa brasileira e outra para ações americanas.</div>`,
            en: `<p>The Investments module is optional and must be activated by the family <strong>administrator</strong>.</p><h4>How to activate</h4><ol><li>Go to <strong>Settings → Modules</strong></li><li>Enable the <strong>Investments</strong> switch</li><li>The <strong>Investments</strong> item will appear in the sidebar</li></ol><h4>Prerequisite: Investment account</h4><p>Before registering positions, create at least one account of type <strong>Investments</strong> in the Accounts screen. This account will be the portfolio grouping your positions.</p><div class="help-tip">💡 You can have multiple investment accounts — for example, one for Brazilian stocks and one for US equities.</div>`,
            es: `<p>El módulo de Inversiones es opcional y debe ser activado por el <strong>administrador</strong> de la familia.</p><h4>Cómo activar</h4><ol><li>Vaya a <strong>Configuración → Módulos</strong></li><li>Active el interruptor <strong>Inversiones</strong></li><li>El ítem <strong>Inversiones</strong> aparecerá en el menú lateral</li></ol><h4>Requisito previo: cuenta de tipo Inversiones</h4><p>Antes de registrar posiciones, cree al menos una cuenta de tipo <strong>Inversiones</strong>.</p><div class="help-tip">💡 Puede tener varias cuentas de inversión según su estrategia.</div>`,
            fr: `<p>Le module Investissements est optionnel et doit être activé par l'<strong>administrateur</strong> de la famille.</p><h4>Comment activer</h4><ol><li>Allez dans <strong>Paramètres → Modules</strong></li><li>Activez le commutateur <strong>Investissements</strong></li><li>L'item <strong>Investissements</strong> apparaîtra dans la barre latérale</li></ol><h4>Prérequis : compte Investissements</h4><p>Avant d'enregistrer des positions, créez au moins un compte de type <strong>Investissements</strong>.</p>`,
          },
        },
        {
          id: 'investments-positions',
          title: { pt: 'Posições e movimentações', en: 'Positions and transactions', es: 'Posiciones y movimientos', fr: 'Positions et transactions' },
          body: {
            pt: `<h4>Registrando uma compra</h4><ol><li>Na tela de Investimentos, clique em <strong>+ Movimentação</strong></li><li>Selecione a conta de investimento</li><li>Informe o código do ativo (ex: PETR4, BTC, AAPL)</li><li>Escolha o tipo de ativo</li><li>Informe quantidade e preço unitário</li><li>Clique em <strong>Registrar Compra</strong></li></ol><h4>Tipos de ativos suportados</h4><div class="help-card-grid"><div class="help-mini-card"><strong>🇧🇷 Ação BR</strong>Bolsa brasileira (B3)</div><div class="help-mini-card"><strong>🏢 FII</strong>Fundos imobiliários</div><div class="help-mini-card"><strong>📊 ETF BR</strong>Fundos índice na B3</div><div class="help-mini-card"><strong>🇺🇸 Ação US</strong>NYSE/NASDAQ</div><div class="help-mini-card"><strong>📈 ETF US</strong>SPY, QQQ, VT…</div><div class="help-mini-card"><strong>🌐 BDR</strong>Brazilian Depositary Receipts</div><div class="help-mini-card"><strong>₿ Criptomoeda</strong>BTC, ETH e outros</div><div class="help-mini-card"><strong>💰 Renda Fixa</strong>CDB, LCI, Tesouro…</div></div><h4>Custo médio</h4><p>O app calcula automaticamente o custo médio ponderado. Cada nova compra recalcula o preço médio da posição.</p><h4>Venda parcial ou total</h4><p>Use a aba <strong>Venda</strong> no modal para registrar uma desinvestimento. O app verifica se a quantidade disponível é suficiente.</p><div class="help-tip">💡 Clique em 📋 ao lado de qualquer posição para ver o histórico completo de movimentações daquele ativo.</div>`,
            en: `<h4>Recording a purchase</h4><ol><li>On the Investments screen, click <strong>+ Transaction</strong></li><li>Select the investment account</li><li>Enter the asset ticker (e.g. AAPL, BTC, PETR4)</li><li>Choose the asset type</li><li>Enter quantity and unit price</li><li>Click <strong>Record Purchase</strong></li></ol><h4>Supported asset types</h4><div class="help-card-grid"><div class="help-mini-card"><strong>🇧🇷 BR Stock</strong>Brazilian stock exchange (B3)</div><div class="help-mini-card"><strong>🏢 FII</strong>Real estate investment trusts</div><div class="help-mini-card"><strong>📊 BR ETF</strong>Index funds on B3</div><div class="help-mini-card"><strong>🇺🇸 US Stock</strong>NYSE/NASDAQ</div><div class="help-mini-card"><strong>📈 US ETF</strong>SPY, QQQ, VT…</div><div class="help-mini-card"><strong>₿ Crypto</strong>BTC, ETH and others</div><div class="help-mini-card"><strong>💰 Fixed Income</strong>Bonds, CDs, Treasury…</div></div><h4>Average cost</h4><p>The app automatically calculates the weighted average cost. Each new purchase recalculates the average price for the position.</p><div class="help-tip">💡 Click 📋 next to any position to see the full transaction history for that asset.</div>`,
            es: `<h4>Registrar una compra</h4><ol><li>En la pantalla de Inversiones, haga clic en <strong>+ Movimiento</strong></li><li>Seleccione la cuenta de inversiones</li><li>Ingrese el código del activo (ej: PETR4, BTC, AAPL)</li><li>Elija el tipo de activo</li><li>Ingrese cantidad y precio unitario</li></ol><div class="help-tip">💡 Haga clic en 📋 junto a cualquier posición para ver el historial completo de movimientos.</div>`,
            fr: `<h4>Enregistrer un achat</h4><ol><li>Sur l'écran Investissements, cliquez sur <strong>+ Transaction</strong></li><li>Sélectionnez le compte d'investissement</li><li>Entrez le code de l'actif (ex : AAPL, BTC, PETR4)</li><li>Choisissez le type d'actif</li><li>Entrez la quantité et le prix unitaire</li></ol><div class="help-tip">💡 Cliquez sur 📋 à côté d'une position pour voir l'historique complet des transactions.</div>`,
          },
        },
        {
          id: 'investments-prices',
          title: { pt: 'Cotações e gráficos de performance', en: 'Quotes and performance charts', es: 'Cotizaciones y gráficos de rendimiento', fr: 'Cotations et graphiques de performance' },
          body: {
            pt: `<h4>Atualização automática de cotações</h4><p>Clique em <strong>🔄 Cotações</strong> para atualizar os preços de todas as posições abertas em um clique. As fontes são:</p><ul><li><strong>Ações BR / FIIs / BDRs:</strong> brapi.dev (B3 em tempo real)</li><li><strong>Ações US / ETFs US:</strong> Yahoo Finance</li><li><strong>Criptomoedas:</strong> CoinGecko (BTC, ETH, BNB e outros principais)</li><li><strong>Renda Fixa / Outro:</strong> atualização manual</li></ul><h4>Gráfico de Evolução da Carteira</h4><p>Na tela de Investimentos, dois gráficos são exibidos automaticamente após o carregamento das posições:</p><ul><li><strong>Evolução da Carteira:</strong> linha temporal do valor de mercado total vs custo total — mostra o P&L acumulado ao longo do tempo</li><li><strong>Alocação por Tipo de Ativo:</strong> rosca com a distribuição percentual entre Ações BR, FIIs, ETFs, Crypto, Renda Fixa e outros</li></ul><h4>Gráfico por posição</h4><p>Abra o detalhe (📋) de qualquer posição para ver o gráfico individual de evolução do preço e P&L daquele ativo.</p><div class="help-tip">💡 Quanto mais vezes você atualizar cotações, mais rico fica o histórico de preços e mais preciso o gráfico de evolução.</div><div class="help-warning">⚠️ Os gráficos usam o histórico de preços armazenado no banco. Posições sem histórico não aparecem na linha temporal.</div>`,
            en: `<h4>Automatic price updates</h4><p>Click <strong>🔄 Quotes</strong> to update prices for all open positions in one click. Sources are:</p><ul><li><strong>BR Stocks / FIIs / BDRs:</strong> brapi.dev (real-time B3)</li><li><strong>US Stocks / ETFs:</strong> Yahoo Finance</li><li><strong>Crypto:</strong> CoinGecko (BTC, ETH, BNB and other majors)</li><li><strong>Fixed Income / Other:</strong> manual update</li></ul><h4>Portfolio evolution chart</h4><p>On the Investments screen, two charts are displayed automatically after positions load:</p><ul><li><strong>Portfolio Evolution:</strong> timeline of total market value vs total cost — shows accumulated P&L over time</li><li><strong>Allocation by Asset Type:</strong> donut with the percentage distribution across BR Stocks, FIIs, ETFs, Crypto, Fixed Income and others</li></ul><h4>Per-position chart</h4><p>Open any position's detail (📋) to see the individual price evolution and P&L chart for that asset.</p><div class="help-tip">💡 The more often you update prices, the richer the price history and the more accurate the evolution chart.</div>`,
            es: `<h4>Actualización automática de cotizaciones</h4><p>Haga clic en <strong>🔄 Cotizaciones</strong> para actualizar los precios de todas las posiciones abiertas. Fuentes:</p><ul><li><strong>Acciones BR / FIIs / BDRs:</strong> brapi.dev (B3 en tiempo real)</li><li><strong>Acciones US / ETFs US:</strong> Yahoo Finance</li><li><strong>Criptomonedas:</strong> CoinGecko</li><li><strong>Renta Fija / Otro:</strong> actualización manual</li></ul><h4>Gráficos de rendimiento</h4><p>Dos gráficos se muestran automáticamente: evolución de la cartera (valor de mercado vs coste) y alocación por tipo de activo (rosca).</p>`,
            fr: `<h4>Mise à jour automatique des cotations</h4><p>Cliquez sur <strong>🔄 Cotations</strong> pour mettre à jour les prix de toutes les positions ouvertes. Sources :</p><ul><li><strong>Actions BR / FIIs / BDRs :</strong> brapi.dev (B3 en temps réel)</li><li><strong>Actions US / ETFs US :</strong> Yahoo Finance</li><li><strong>Cryptomonnaies :</strong> CoinGecko</li><li><strong>Revenu fixe / Autre :</strong> mise à jour manuelle</li></ul><h4>Graphiques de performance</h4><p>Deux graphiques sont affichés automatiquement : évolution du portefeuille et allocation par type d'actif.</p>`,
          },
        },
      ],
    },
    {
      id: 'debts', icon: '💳', color: '#dc2626',
      title: { pt: 'Dívidas', en: 'Debts', es: 'Deudas', fr: 'Dettes' },
      articles: [
        {
          id: 'debts-activation',
          title: { pt: 'Módulo de Dívidas', en: 'Debts module', es: 'Módulo de Deudas', fr: 'Module Dettes' },
          body: {
            pt: `_helpIntroCard('Por que controlar dívidas?','💳','Dívida não controlada cresce exponencialmente por causa dos juros compostos — o mesmo mecanismo que faz investimentos crescerem, aplicado ao contrário. <strong>Controlar dívidas</strong> significa saber exatamente quanto você deve, para quem, a que taxa e quando acaba. Com essa informação, você pode aplicar estratégias como a <em>bola de neve</em> (quitar menor primeiro para ganhar motivação) ou <em>avalanche</em> (quitar a de maior juros para pagar menos no total) e acelerar sua libertação financeira.','#dc2626') +
<p>O módulo de Dívidas permite controlar empréstimos, financiamentos e qualquer obrigação financeira ativa.</p><h4>Como ativar</h4><ol><li>Acesse <strong>Configurações → Módulos</strong> e ative <strong>Dívidas</strong></li><li>O item <strong>Dívidas</strong> aparecerá no menu lateral</li></ol><h4>O que você pode registrar</h4><ul><li>Empréstimos bancários e pessoais</li><li>Financiamentos (imóvel, veículo)</li><li>Cartões de crédito (saldo devedor)</li><li>Dívidas com pessoas físicas</li></ul><h4>Tipos de indexação</h4><p>Cada dívida pode ter seu índice de correção: <strong>Juros Fixos</strong>, SELIC, IPCA, IGPM, CDI, Poupança ou Manual.</p><h4>Amortizações</h4><p>Registre pagamentos de parcelas. O app recalcula automaticamente o saldo devedor e o percentual amortizado.</p><h4>Análise no AI Insights</h4><p>Quando o módulo de Dívidas está ativo e há dados, a IA inclui automaticamente a análise de dívidas no relatório de AI Insights, com estratégias de quitação e impacto no fluxo de caixa.</p><div class="help-tip">💡 Acompanhe o campo "% Amortizado" para visualizar o progresso de cada dívida ao longo do tempo.</div>`,
            en: `<p>The Debts module lets you track loans, financing and any active financial obligations.</p><h4>How to activate</h4><ol><li>Go to <strong>Settings → Modules</strong> and enable <strong>Debts</strong></li><li>The <strong>Debts</strong> item will appear in the sidebar</li></ol><h4>What you can record</h4><ul><li>Bank and personal loans</li><li>Financing (property, vehicle)</li><li>Credit card debt</li><li>Personal debts</li></ul><h4>Index types</h4><p>Each debt can have its own correction index: <strong>Fixed Rate</strong>, SELIC, IPCA, IGPM, CDI, Savings or Manual.</p><h4>Amortizations</h4><p>Record installment payments. The app automatically recalculates the outstanding balance and amortization percentage.</p><div class="help-tip">💡 Track the "% Amortized" field to visualize each debt's progress over time.</div>`,
            es: `<p>El módulo de Deudas permite controlar préstamos, financiamientos y cualquier obligación financiera activa.</p><h4>Cómo activar</h4><ol><li>Vaya a <strong>Configuración → Módulos</strong> y active <strong>Deudas</strong></li><li>El ítem <strong>Deudas</strong> aparecerá en el menú lateral</li></ol><h4>Tipos de indexación</h4><p>Cada deuda puede tener su índice de corrección: <strong>Interés Fijo</strong>, SELIC, IPCA, IGPM, CDI, Ahorro o Manual.</p>`,
            fr: `<p>Le module Dettes permet de suivre prêts, financements et toute obligation financière active.</p><h4>Comment activer</h4><ol><li>Allez dans <strong>Paramètres → Modules</strong> et activez <strong>Dettes</strong></li><li>L'item <strong>Dettes</strong> apparaîtra dans la barre latérale</li></ol><h4>Types d'indexation</h4><p>Chaque dette peut avoir son indice de correction : <strong>Taux fixe</strong>, SELIC, IPCA, IGPM, CDI, Épargne ou Manuel.</p>`,
          },
        },
      ],
    },
    {
      id: 'prices', icon: '🏪', color: '#0891b2',
      title: { pt: 'Preços', en: 'Prices', es: 'Precios', fr: 'Prix' },
      articles: [
        {
          id: 'prices-activation',
          title: { pt: 'Rastreamento de Preços', en: 'Price Tracking', es: 'Seguimiento de Precios', fr: 'Suivi des Prix' },
          body: {
            pt: `_helpIntroCard('Para que rastrear preços?','🏪','<strong>Rastrear preços</strong> é construir inteligência de compra ao longo do tempo. Um produto que você compra toda semana pode variar 40% de preço entre lojas e entre meses. Sem histórico, você não sabe se o preço de hoje é bom ou ruim. Com histórico, você sabe exatamente quando está no mínimo histórico (ótima hora para estocar) e quando está caro (esperar ou buscar alternativa). É uma das formas mais simples de economizar sem mudar seu padrão de vida.','#0891b2') +
<p>O módulo de Preços permite cadastrar produtos com histórico de preços em diferentes lojas, ajudando a identificar a melhor oferta e economizar nas compras.</p><h4>Como ativar</h4><ol><li>Acesse <strong>Configurações → Módulos</strong> e ative <strong>Gestão de Preços</strong></li><li>O item <strong>Preços</strong> aparecerá no menu lateral</li></ol><h4>Como usar</h4><ol><li>Cadastre itens (produto + unidade de medida)</li><li>Registre o preço atual de cada item em diferentes lojas</li><li>O app calcula automaticamente preço mínimo, máximo e médio</li><li>Use o histórico para identificar tendências de preço</li></ol><h4>Integração com Lista de Mercado</h4><p>Os itens cadastrados em Preços ficam disponíveis na Lista de Mercado. Ao marcar itens como comprados, o preço pago é registrado automaticamente no histórico.</p><h4>Análise no AI Insights</h4><p>Quando há dados de rastreamento de preços, a IA inclui dicas de economia e análises de tendência de preços no relatório de AI Insights.</p><div class="help-tip">💡 Registre preços toda vez que for ao mercado. Com histórico acumulado, você saberá exatamente qual loja tem os melhores preços para cada produto.</div>`,
            en: `<p>The Prices module lets you catalog products with price history across different stores, helping you find the best deal and save on purchases.</p><h4>How to activate</h4><ol><li>Go to <strong>Settings → Modules</strong> and enable <strong>Price Management</strong></li><li>The <strong>Prices</strong> item will appear in the sidebar</li></ol><h4>How to use</h4><ol><li>Register items (product + unit of measure)</li><li>Record the current price for each item at different stores</li><li>The app automatically calculates minimum, maximum and average prices</li><li>Use history to identify price trends</li></ol><h4>Grocery list integration</h4><p>Items registered in Prices are available in the Grocery List. When items are marked as purchased, the paid price is automatically recorded in the history.</p><div class="help-tip">💡 Record prices every time you go shopping. With accumulated history, you'll know exactly which store has the best prices for each product.</div>`,
            es: `<p>El módulo de Precios permite catalogar productos con historial de precios en diferentes tiendas.</p><h4>Cómo activar</h4><ol><li>Vaya a <strong>Configuración → Módulos</strong> y active <strong>Gestión de Precios</strong></li></ol><h4>Cómo usar</h4><ol><li>Registre artículos (producto + unidad de medida)</li><li>Ingrese el precio actual en diferentes tiendas</li><li>La app calcula automáticamente precio mínimo, máximo y promedio</li></ol>`,
            fr: `<p>Le module Prix permet de cataloguer des produits avec historique de prix dans différents magasins.</p><h4>Comment activer</h4><ol><li>Allez dans <strong>Paramètres → Modules</strong> et activez <strong>Gestion des prix</strong></li></ol><h4>Comment utiliser</h4><ol><li>Enregistrez des articles (produit + unité de mesure)</li><li>Saisissez le prix actuel dans différents magasins</li><li>L'app calcule automatiquement le prix min, max et moyen</li></ol>`,
          },
        },
      ],
    },
    {
      id: 'ai-insights-advanced', icon: '🧠', color: '#6d28d9',
      title: { pt: 'AI Insights — Avançado', en: 'AI Insights — Advanced', es: 'AI Insights — Avanzado', fr: 'AI Insights — Avancé' },
      articles: [
        {
          id: 'ai-snapshots',
          title: { pt: 'Snapshots e histórico de análises', en: 'Snapshots and analysis history', es: 'Snapshots e historial de análisis', fr: 'Snapshots et historique des analyses' },
          body: {
            pt: `<p>O recurso de <strong>Snapshots</strong> permite salvar e comparar análises financeiras ao longo do tempo.</p><h4>Salvando um snapshot</h4><ol><li>Após gerar uma análise, clique em <strong>💾 Salvar snapshot</strong></li><li>Dê um título descritivo (ex: "Fechamento de março · cenário conservador")</li><li>Adicione contexto adicional para a IA se desejar</li></ol><h4>Consultando snapshots</h4><ol><li>Acesse a aba <strong>Snapshots</strong></li><li>Veja o histórico de análises salvas para a família</li><li>Abra qualquer snapshot para rever a análise completa daquele momento</li></ol><div class="help-tip">💡 Salve um snapshot no início e no fim de cada mês para ter um histórico da evolução financeira da família.</div>`,
            en: `<p>The <strong>Snapshots</strong> feature lets you save and compare financial analyses over time.</p><h4>Saving a snapshot</h4><ol><li>After generating an analysis, click <strong>💾 Save snapshot</strong></li><li>Give it a descriptive title (e.g., "March closing · conservative scenario")</li><li>Add additional context for the AI if desired</li></ol><h4>Browsing snapshots</h4><ol><li>Go to the <strong>Snapshots</strong> tab</li><li>View the history of saved analyses for the family</li><li>Open any snapshot to review the full analysis from that moment</li></ol><div class="help-tip">💡 Save a snapshot at the start and end of each month for a history of the family's financial evolution.</div>`,
            es: `<p>La función <strong>Snapshots</strong> permite guardar y comparar análisis financieros a lo largo del tiempo.</p><h4>Guardar un snapshot</h4><ol><li>Tras generar un análisis, haga clic en <strong>💾 Guardar snapshot</strong></li><li>Asígnele un título descriptivo</li></ol><h4>Consultar snapshots</h4><ol><li>Acceda a la pestaña <strong>Snapshots</strong></li><li>Vea el historial de análisis guardados para la familia</li></ol><div class="help-tip">💡 Guarde un snapshot a principios y finales de cada mes para tener un historial de la evolución financiera familiar.</div>`,
            fr: `<p>La fonction <strong>Snapshots</strong> vous permet de sauvegarder et comparer des analyses financières dans le temps.</p><h4>Sauvegarder un snapshot</h4><ol><li>Après avoir généré une analyse, cliquez sur <strong>💾 Sauvegarder snapshot</strong></li><li>Donnez-lui un titre descriptif</li></ol><h4>Consulter les snapshots</h4><ol><li>Accédez à l'onglet <strong>Snapshots</strong></li><li>Voir l'historique des analyses sauvegardées pour la famille</li></ol>`,
          },
        },
        {
          id: 'ai-full-report',
          title: { pt: 'O que o relatório AI inclui', en: 'What the AI report includes', es: 'Qué incluye el informe de IA', fr: "Ce qu'inclut le rapport IA" },
          body: {
            pt: `<p>O relatório gerado pelo AI Insights é dividido nas seguintes seções:</p><div class="help-card-grid"><div class="help-mini-card"><strong>🏥 Score de Saúde</strong>0-100 calculado com base na taxa de poupança e risco identificado</div><div class="help-mini-card"><strong>🤖 Análise Gemini</strong>Resumo do período em linguagem natural com comentários sobre receitas, despesas e resultado</div><div class="help-mini-card"><strong>⚠️ Alertas</strong>Avisos de fluxo de caixa e anomalias detectadas automaticamente</div><div class="help-mini-card"><strong>🔮 Prognóstico</strong>Projeção de 6 meses com tabela expansível por mês, riscos e oportunidades</div><div class="help-mini-card"><strong>💡 Recomendações</strong>Oportunidades de economia e ações concretas priorizadas</div><div class="help-mini-card"><strong>📊 Categorias</strong>Barras horizontais com insight da IA para cada categoria principal</div><div class="help-mini-card"><strong>💳 Cartões</strong>Análise de gastos programados em cartões de crédito</div><div class="help-mini-card"><strong>🎯 Orçamentos</strong>Status de cada orçamento mensal ativo</div><div class="help-mini-card"><strong>📈 Investimentos</strong>Análise da carteira, P&L, diversificação e recomendações (se ativo)</div><div class="help-mini-card"><strong>💳 Dívidas</strong>Estratégia de quitação e impacto no fluxo de caixa (se ativo)</div><div class="help-mini-card"><strong>🏷️ Preços</strong>Dicas de economia baseadas no histórico de preços (se ativo)</div><div class="help-mini-card"><strong>👥 Membros</strong>Análise individual de gastos por membro da família</div></div><div class="help-tip">💡 As seções de Investimentos, Dívidas e Preços aparecem automaticamente quando os respectivos módulos estão ativos e há dados registrados.</div>`,
            en: `<p>The report generated by AI Insights is divided into the following sections:</p><div class="help-card-grid"><div class="help-mini-card"><strong>🏥 Health Score</strong>0-100 calculated based on savings rate and identified risk</div><div class="help-mini-card"><strong>🤖 Gemini Analysis</strong>Period summary in natural language</div><div class="help-mini-card"><strong>⚠️ Alerts</strong>Cash flow warnings and automatically detected anomalies</div><div class="help-mini-card"><strong>🔮 Forecast</strong>6-month projection with expandable monthly table</div><div class="help-mini-card"><strong>💡 Recommendations</strong>Savings opportunities and concrete prioritized actions</div><div class="help-mini-card"><strong>📊 Categories</strong>Horizontal bars with AI insight for each main category</div><div class="help-mini-card"><strong>📈 Investments</strong>Portfolio analysis, P&L, diversification (if active)</div><div class="help-mini-card"><strong>💳 Debts</strong>Payoff strategy and cash flow impact (if active)</div><div class="help-mini-card"><strong>🏷️ Prices</strong>Savings tips based on price history (if active)</div></div><div class="help-tip">💡 The Investments, Debts and Prices sections appear automatically when the respective modules are active and have data.</div>`,
            es: `<p>El informe generado por AI Insights se divide en las siguientes secciones:</p><div class="help-card-grid"><div class="help-mini-card"><strong>🏥 Score de Salud</strong>0-100 basado en tasa de ahorro y riesgo identificado</div><div class="help-mini-card"><strong>🤖 Análisis Gemini</strong>Resumen del período en lenguaje natural</div><div class="help-mini-card"><strong>⚠️ Alertas</strong>Avisos de flujo de caja y anomalías detectadas</div><div class="help-mini-card"><strong>🔮 Pronóstico</strong>Proyección de 6 meses</div><div class="help-mini-card"><strong>📈 Inversiones</strong>Análisis de cartera (si está activo)</div><div class="help-mini-card"><strong>💳 Deudas</strong>Estrategia de pago (si está activo)</div></div>`,
            fr: `<p>Le rapport généré par AI Insights est divisé en sections :</p><div class="help-card-grid"><div class="help-mini-card"><strong>🏥 Score de santé</strong>0-100 basé sur le taux d'épargne et le risque identifié</div><div class="help-mini-card"><strong>🤖 Analyse Gemini</strong>Résumé de la période en langage naturel</div><div class="help-mini-card"><strong>🔮 Prévision</strong>Projection sur 6 mois</div><div class="help-mini-card"><strong>📈 Investissements</strong>Analyse du portefeuille (si actif)</div><div class="help-mini-card"><strong>💳 Dettes</strong>Stratégie de remboursement (si actif)</div></div>`,
          },
        },
        {
          id: 'ai-setup',
          title: { pt: 'Configurando a chave de API Gemini', en: 'Setting up the Gemini API key', es: 'Configurar la clave API de Gemini', fr: "Configurer la clé API Gemini" },
          body: {
            pt: `<p>O AI Insights usa o modelo Gemini do Google. Para ativar, você precisa de uma chave de API gratuita.</p><h4>Como obter a chave</h4><ol><li>Acesse <a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a></li><li>Faça login com sua conta Google</li><li>Clique em <strong>Get API Key → Create API Key</strong></li><li>Copie a chave gerada (começa com "AIza…")</li></ol><h4>Como configurar no app</h4><ol><li>Acesse <strong>Configurações → AI & Automação</strong></li><li>Cole a chave no campo <strong>Chave API Gemini</strong></li><li>Salve. O módulo AI Insights ficará disponível no menu.</li></ol><div class="help-warning">⚠️ Mantenha sua chave de API em sigilo. Não compartilhe com terceiros.</div><div class="help-tip">💡 A chave gratuita do Google AI Studio tem limite generoso para uso pessoal e familiar.</div>`,
            en: `<p>AI Insights uses Google's Gemini model. To activate, you need a free API key.</p><h4>How to get the key</h4><ol><li>Go to <a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a></li><li>Sign in with your Google account</li><li>Click <strong>Get API Key → Create API Key</strong></li><li>Copy the generated key (starts with "AIza…")</li></ol><h4>How to set it up in the app</h4><ol><li>Go to <strong>Settings → AI & Automation</strong></li><li>Paste the key in the <strong>Gemini API Key</strong> field</li><li>Save. The AI Insights module will become available in the menu.</li></ol><div class="help-warning">⚠️ Keep your API key secret. Do not share it with third parties.</div>`,
            es: `<p>AI Insights usa el modelo Gemini de Google. Para activarlo, necesita una clave API gratuita.</p><h4>Cómo obtener la clave</h4><ol><li>Vaya a <a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a></li><li>Inicie sesión con su cuenta de Google</li><li>Haga clic en <strong>Get API Key → Create API Key</strong></li><li>Copie la clave generada (comienza con "AIza…")</li></ol><h4>Cómo configurar en la app</h4><ol><li>Vaya a <strong>Configuración → IA y Automatización</strong></li><li>Pegue la clave en el campo <strong>Clave API Gemini</strong></li></ol>`,
            fr: `<p>AI Insights utilise le modèle Gemini de Google. Pour l'activer, vous avez besoin d'une clé API gratuite.</p><h4>Comment obtenir la clé</h4><ol><li>Allez sur <a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a></li><li>Connectez-vous avec votre compte Google</li><li>Cliquez sur <strong>Get API Key → Create API Key</strong></li><li>Copiez la clé générée (commence par "AIza…")</li></ol><h4>Comment configurer dans l'app</h4><ol><li>Allez dans <strong>Paramètres → IA et Automatisation</strong></li><li>Collez la clé dans le champ <strong>Clé API Gemini</strong></li></ol>`,
          },
        },
      ],
    },
    {
      id: 'grocery', icon: '🛒', color: '#16a34a',
      title: { pt: 'Lista de Mercado', en: 'Grocery List', es: 'Lista de Compras', fr: 'Liste de Courses' },
      articles: [
        {
          id: 'grocery-intro',
          title: { pt: 'Como usar a Lista de Mercado', en: 'How to use the Grocery List', es: 'Cómo usar la Lista de Compras', fr: 'Comment utiliser la Liste de Courses' },
          body: {
            pt: `<p>A Lista de Mercado permite criar listas de compras integradas ao catálogo de preços da família.</p><h4>Como ativar</h4><ol><li>Acesse <strong>Configurações → Módulos</strong> e ative <strong>Lista de Mercado</strong></li></ol><h4>Como usar</h4><ol><li>Crie uma nova lista de compras</li><li>Adicione itens com quantidade desejada</li><li>Ao fazer compras, marque os itens como comprados e informe o preço pago</li><li>O preço é automaticamente registrado no histórico de Preços</li></ol><h4>Integração com Preços</h4><p>Se o módulo de Preços estiver ativo, ao adicionar itens à lista você verá o preço histórico de referência, ajudando a identificar se o preço atual está acima ou abaixo da média.</p><div class="help-tip">💡 Use a lista em conjunto com o módulo de Preços para construir um histórico rico e sempre saber onde comprar mais barato.</div>`,
            en: `<p>The Grocery List lets you create shopping lists integrated with the family's price catalog.</p><h4>How to activate</h4><ol><li>Go to <strong>Settings → Modules</strong> and enable <strong>Grocery List</strong></li></ol><h4>How to use</h4><ol><li>Create a new shopping list</li><li>Add items with the desired quantity</li><li>While shopping, mark items as purchased and enter the price paid</li><li>The price is automatically recorded in the Price history</li></ol><div class="help-tip">💡 Use the list together with the Prices module to build a rich history and always know where to buy cheaper.</div>`,
            es: `<p>La Lista de Compras permite crear listas integradas al catálogo de precios de la familia.</p><h4>Cómo activar</h4><ol><li>Vaya a <strong>Configuración → Módulos</strong> y active <strong>Lista de Compras</strong></li></ol><h4>Cómo usar</h4><ol><li>Cree una nueva lista de compras</li><li>Agregue artículos con la cantidad deseada</li><li>Al comprar, marque los artículos como comprados e ingrese el precio pagado</li></ol>`,
            fr: `<p>La Liste de Courses vous permet de créer des listes de courses intégrées au catalogue de prix de la famille.</p><h4>Comment activer</h4><ol><li>Allez dans <strong>Paramètres → Modules</strong> et activez <strong>Liste de Courses</strong></li></ol><h4>Comment utiliser</h4><ol><li>Créez une nouvelle liste de courses</li><li>Ajoutez des articles avec la quantité souhaitée</li><li>Lors des courses, marquez les articles comme achetés et saisissez le prix payé</li></ol>`,
          },
        },
      ],
    },
    {
      id: 'dashboard-advanced', icon: '🏠', color: '#2563eb',
      title: { pt: 'Dashboard — Avançado', en: 'Dashboard — Advanced', es: 'Panel — Avanzado', fr: 'Tableau de bord — Avancé' },
      articles: [
        {
          id: 'dashboard-customization',
          title: { pt: 'Personalização do Dashboard', en: 'Dashboard customization', es: 'Personalización del Panel', fr: 'Personnalisation du tableau de bord' },
          body: {
            pt: `<p>O Dashboard pode ser personalizado para mostrar apenas as informações relevantes para você.</p><h4>Cards e seções disponíveis</h4><div class="help-card-grid"><div class="help-mini-card"><strong>Saldo por Conta</strong>Cards favoritos + grupos colapsáveis para demais contas</div><div class="help-mini-card"><strong>KPIs do mês</strong>4 cards: Patrimônio, Receitas, Despesas e Saldo — em linha única no desktop</div><div class="help-mini-card"><strong>Próximos Programados</strong>Vencimentos e recorrências nos próximos dias</div><div class="help-mini-card"><strong>Categorias Favoritas</strong>Gráfico de evolução das categorias marcadas como favoritas</div><div class="help-mini-card"><strong>Previsão de Caixa</strong>Gráfico de evolução do saldo projetado</div><div class="help-mini-card"><strong>Lançamentos Recentes</strong>Últimas transações com filtro de status</div></div><h4>Contas favoritas</h4><p>Marque contas como favoritas (⭐ na tela de Contas) para que apareçam como cards visuais no topo do Dashboard. Contas favoritas mostram:</p><ul><li>Saldo total (incluindo pendentes)</li><li>Saldo só de confirmados (quando há transações pendentes)</li><li>Conversão em BRL para contas em moeda estrangeira</li></ul><h4>Filtro por membro</h4><p>Use o filtro de membro no Dashboard para ver os KPIs e lançamentos recentes de um membro específico da família.</p><div class="help-tip">💡 No desktop, os 4 KPIs aparecem em linha única para aproveitar o espaço horizontal. No mobile, ficam em grade 2×2.</div>`,
            en: `<p>The Dashboard can be customized to show only the information relevant to you.</p><h4>Available cards and sections</h4><div class="help-card-grid"><div class="help-mini-card"><strong>Balance by Account</strong>Favorite cards + collapsible groups for other accounts</div><div class="help-mini-card"><strong>Month KPIs</strong>4 cards: Net Worth, Income, Expenses and Balance — single row on desktop</div><div class="help-mini-card"><strong>Upcoming Scheduled</strong>Due dates and recurring items in coming days</div><div class="help-mini-card"><strong>Favorite Categories</strong>Evolution chart of categories marked as favorites</div></div><h4>Favorite accounts</h4><p>Mark accounts as favorites (⭐ in Accounts) to appear as visual cards at the top of the Dashboard. Favorite cards show:</p><ul><li>Total balance (including pending)</li><li>Confirmed-only balance (when there are pending transactions)</li><li>BRL conversion for foreign currency accounts</li></ul><div class="help-tip">💡 On desktop, the 4 KPIs appear in a single row to use horizontal space. On mobile, they appear in a 2×2 grid.</div>`,
            es: `<p>El Panel puede personalizarse para mostrar solo la información relevante para usted.</p><h4>Cards y secciones disponibles</h4><div class="help-card-grid"><div class="help-mini-card"><strong>Saldo por Cuenta</strong>Cards favoritos + grupos contraíbles</div><div class="help-mini-card"><strong>KPIs del mes</strong>4 cards en línea única en escritorio</div><div class="help-mini-card"><strong>Categorías Favoritas</strong>Gráfico de evolución</div><div class="help-mini-card"><strong>Lanzamientos Recientes</strong>Últimas transacciones</div></div>`,
            fr: `<p>Le tableau de bord peut être personnalisé pour n'afficher que les informations pertinentes pour vous.</p><h4>Cartes et sections disponibles</h4><div class="help-card-grid"><div class="help-mini-card"><strong>Solde par compte</strong>Cartes favorites + groupes repliables</div><div class="help-mini-card"><strong>KPI du mois</strong>4 cartes sur une seule ligne en desktop</div><div class="help-mini-card"><strong>Catégories favorites</strong>Graphique d'évolution</div><div class="help-mini-card"><strong>Transactions récentes</strong>Dernières transactions</div></div>`,
          },
        },
      ],
    },
    {
      id: 'scheduled-advanced', icon: '📅', color: '#d97706',
      title: { pt: 'Programados — Avançado', en: 'Scheduled — Advanced', es: 'Programados — Avanzado', fr: 'Programmés — Avancé' },
      articles: [
        {
          id: 'scheduled-layout',
          title: { pt: 'Layout e visualizações', en: 'Layout and views', es: 'Diseño y vistas', fr: 'Mise en page et vues' },
          body: {
            pt: `<p>A tela de Programados foi redesenhada com um layout moderno e informações contextuais.</p><h4>Layout Desktop</h4><p>Dois painéis lado a lado:</p><ul><li><strong>Painel esquerdo — Próximos 10 dias:</strong> timeline de todos os vencimentos dos próximos 10 dias com opções de registrar ou ignorar cada ocorrência</li><li><strong>Painel direito — Recorrentes:</strong> lista de todos os lançamentos programados ativos com filtros de busca e status</li></ul><h4>Layout Mobile</h4><p>Painel único em timeline vertical — os próximos 10 dias aparecem primeiro, seguidos pela lista de recorrentes.</p><h4>KPIs no cabeçalho</h4><p>No topo da página (desktop), três indicadores mostram:</p><ul><li>💸 Despesas previstas nos próximos 30 dias</li><li>💰 Receitas previstas nos próximos 30 dias</li><li>⏳ Quantidade de lançamentos pendentes/atrasados</li></ul><h4>Modos de visualização</h4><ul><li><strong>Lista:</strong> exibe o layout de dois painéis descrito acima</li><li><strong>Calendário:</strong> visão mensal em grade com os vencimentos marcados</li><li><strong>Categorias:</strong> agrupa recorrentes por categoria de gasto</li></ul><div class="help-tip">💡 Use "Registrar" na timeline para transformar um programado em lançamento real confirmado com um clique.</div>`,
            en: `<p>The Scheduled screen has been redesigned with a modern layout and contextual information.</p><h4>Desktop Layout</h4><p>Two side-by-side panels:</p><ul><li><strong>Left panel — Next 10 days:</strong> timeline of all upcoming due dates with options to register or ignore each occurrence</li><li><strong>Right panel — Recurring:</strong> list of all active scheduled transactions with search and status filters</li></ul><h4>Mobile Layout</h4><p>Single panel in vertical timeline — the next 10 days appear first, followed by the list of recurring transactions.</p><h4>KPIs in the header</h4><p>At the top of the page (desktop), three indicators show:</p><ul><li>💸 Projected expenses in the next 30 days</li><li>💰 Projected income in the next 30 days</li><li>⏳ Number of pending/overdue transactions</li></ul><div class="help-tip">💡 Use "Register" in the timeline to turn a scheduled transaction into a real confirmed transaction with one click.</div>`,
            es: `<p>La pantalla de Programados fue rediseñada con un diseño moderno.</p><h4>Diseño de escritorio</h4><p>Dos paneles lado a lado:</p><ul><li><strong>Panel izquierdo — Próximos 10 días:</strong> línea de tiempo de vencimientos con opciones de registrar o ignorar</li><li><strong>Panel derecho — Recurrentes:</strong> lista de todos los programados activos con filtros</li></ul><h4>KPIs en el encabezado</h4><ul><li>💸 Gastos previstos en los próximos 30 días</li><li>💰 Ingresos previstos en los próximos 30 días</li><li>⏳ Cantidad de lanzamientos pendientes/atrasados</li></ul>`,
            fr: `<p>L'écran Programmés a été repensé avec une mise en page moderne.</p><h4>Mise en page Desktop</h4><p>Deux panneaux côte à côte :</p><ul><li><strong>Panneau gauche — 10 prochains jours :</strong> chronologie des échéances avec options d'enregistrement ou d'ignorance</li><li><strong>Panneau droit — Récurrents :</strong> liste de toutes les transactions programmées actives avec filtres</li></ul><h4>KPI dans l'en-tête</h4><ul><li>💸 Dépenses prévues dans les 30 prochains jours</li><li>💰 Revenus prévus dans les 30 prochains jours</li><li>⏳ Nombre de transactions en attente/en retard</li></ul>`,
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
    {
      id: 'modules', icon: '🧩', color: '#7c3aed',
      title: { pt: 'Módulos & Funcionalidades', en: 'Modules & Features', es: 'Módulos y funciones', fr: 'Modules et fonctionnalités' },
      articles: [
        {
          id: 'optional-modules',
          title: { pt: 'Módulos opcionais', en: 'Optional modules', es: 'Módulos opcionales', fr: 'Modules optionnels' },
          body: {
            pt: `<p>O Family FinTrack possui módulos opcionais que podem ser ativados conforme a sua necessidade.</p>
<div class="help-card-grid">
  <div class="help-mini-card" style="border-left:3px solid #0891b2">
    <strong>🏷️ Rastreamento de Preços</strong>
    Compare preços entre supermercados e acompanhe histórico de produtos
    <br><br><button class="help-action-btn" onclick="navigate('prices');if(typeof closeModal==='function')closeModal('myProfileModal')">Ir para Preços →</button>
  </div>
  <div class="help-mini-card" style="border-left:3px solid #16a34a">
    <strong>📈 Investimentos</strong>
    Carteira de ações, FIIs, renda fixa e criptomoedas com rentabilidade
    <br><br><button class="help-action-btn" onclick="navigate('investments')">Ir para Investimentos →</button>
  </div>
  <div class="help-mini-card" style="border-left:3px solid #dc2626">
    <strong>💳 Gestão de Dívidas</strong>
    Controle empréstimos, parcelas e acompanhe o progresso de quitação
    <br><br><button class="help-action-btn" onclick="navigate('debts')">Ir para Dívidas →</button>
  </div>
  <div class="help-mini-card" style="border-left:3px solid #7c3aed">
    <strong>🤖 IA Insights</strong>
    Análise inteligente com Gemini AI: padrões, previsões e recomendações
    <br><br><button class="help-action-btn" onclick="navigate('ai_insights')">Ir para IA Insights →</button>
  </div>
</div>
<div class="help-tip">💡 Para ativar ou desativar módulos: acesse seu <button onclick="openMyProfile();setTimeout(()=>document.querySelector('[onclick*=profTabPrefs]')?.click(),400)" style="background:none;border:none;color:var(--accent);font-weight:700;cursor:pointer;font-family:inherit;font-size:inherit">Perfil → Preferências</button> e use o botão "Reiniciar wizard" para reconfigurar os módulos ativos.</div>`,
            en: `<p>Family FinTrack has optional modules that can be activated as needed.</p>
<div class="help-card-grid">
  <div class="help-mini-card" style="border-left:3px solid #0891b2"><strong>🏷️ Price Tracking</strong> Compare prices across stores and track product history<br><br><button class="help-action-btn" onclick="navigate('prices')">Go to Prices →</button></div>
  <div class="help-mini-card" style="border-left:3px solid #16a34a"><strong>📈 Investments</strong> Portfolio of stocks, funds and fixed income<br><br><button class="help-action-btn" onclick="navigate('investments')">Go to Investments →</button></div>
  <div class="help-mini-card" style="border-left:3px solid #dc2626"><strong>💳 Debt Management</strong> Track loans and installments<br><br><button class="help-action-btn" onclick="navigate('debts')">Go to Debts →</button></div>
  <div class="help-mini-card" style="border-left:3px solid #7c3aed"><strong>🤖 AI Insights</strong> Smart financial analysis powered by Gemini AI<br><br><button class="help-action-btn" onclick="navigate('ai_insights')">Go to AI Insights →</button></div>
</div>`,
            es: `<p>Family FinTrack tiene módulos opcionales que se pueden activar según sus necesidades.</p>
<div class="help-card-grid">
  <div class="help-mini-card"><strong>🏷️ Precios</strong> Compare precios entre tiendas<br><br><button class="help-action-btn" onclick="navigate('prices')">Ir a Precios →</button></div>
  <div class="help-mini-card"><strong>📈 Inversiones</strong> Cartera de acciones y renta fija<br><br><button class="help-action-btn" onclick="navigate('investments')">Ir a Inversiones →</button></div>
  <div class="help-mini-card"><strong>💳 Deudas</strong> Control de préstamos<br><br><button class="help-action-btn" onclick="navigate('debts')">Ir a Deudas →</button></div>
  <div class="help-mini-card"><strong>🤖 IA Insights</strong> Análisis inteligente<br><br><button class="help-action-btn" onclick="navigate('ai_insights')">Ir a IA →</button></div>
</div>`,
            fr: `<p>Family FinTrack dispose de modules optionnels activables selon vos besoins.</p>
<div class="help-card-grid">
  <div class="help-mini-card"><strong>🏷️ Prix</strong> Comparez les prix entre magasins<br><br><button class="help-action-btn" onclick="navigate('prices')">Aller aux Prix →</button></div>
  <div class="help-mini-card"><strong>📈 Investissements</strong> Portefeuille d'actions et obligations<br><br><button class="help-action-btn" onclick="navigate('investments')">Aller aux Investissements →</button></div>
  <div class="help-mini-card"><strong>💳 Dettes</strong> Contrôle des prêts<br><br><button class="help-action-btn" onclick="navigate('debts')">Aller aux Dettes →</button></div>
  <div class="help-mini-card"><strong>🤖 IA Insights</strong> Analyse intelligente<br><br><button class="help-action-btn" onclick="navigate('ai_insights')">Aller à l'IA →</button></div>
</div>`,
          },
        },
        {
          id: 'quick-actions',
          title: { pt: 'Ações rápidas', en: 'Quick actions', es: 'Acciones rápidas', fr: 'Actions rapides' },
          body: {
            pt: `<p>Acesse rapidamente as principais funções do app:</p>
<div class="help-action-grid">
  <div class="help-action-card">
    <div class="help-action-icon">💸</div>
    <div class="help-action-label">Nova Transação</div>
    <button class="help-action-btn" onclick="navigate('transactions');setTimeout(()=>typeof openTransactionModal==='function'&&openTransactionModal(),400)">Abrir →</button>
  </div>
  <div class="help-action-card">
    <div class="help-action-icon">🏦</div>
    <div class="help-action-label">Nova Conta</div>
    <button class="help-action-btn" onclick="navigate('accounts');setTimeout(()=>typeof openAccountModal==='function'&&openAccountModal(),400)">Abrir →</button>
  </div>
  <div class="help-action-card">
    <div class="help-action-icon">📅</div>
    <div class="help-action-label">Novo Programado</div>
    <button class="help-action-btn" onclick="navigate('scheduled');setTimeout(()=>typeof openScheduledModal==='function'&&openScheduledModal(),400)">Abrir →</button>
  </div>
  <div class="help-action-card">
    <div class="help-action-icon">📊</div>
    <div class="help-action-label">Ver Relatórios</div>
    <button class="help-action-btn" onclick="navigate('reports')">Abrir →</button>
  </div>
  <div class="help-action-card">
    <div class="help-action-icon">🎯</div>
    <div class="help-action-label">Ver Orçamentos</div>
    <button class="help-action-btn" onclick="navigate('budgets')">Abrir →</button>
  </div>
  <div class="help-action-card">
    <div class="help-action-icon">⚙️</div>
    <div class="help-action-label">Configurações</div>
    <button class="help-action-btn" onclick="navigate('settings')">Abrir →</button>
  </div>
  <div class="help-action-card">
    <div class="help-action-icon">🧙</div>
    <div class="help-action-label">Reiniciar Wizard</div>
    <button class="help-action-btn" onclick="openMyProfile();setTimeout(()=>document.querySelectorAll('.prof-ctx-tab')[2]?.click(),400)">Abrir →</button>
  </div>
  <div class="help-action-card">
    <div class="help-action-icon">🔒</div>
    <div class="help-action-label">Política de Privacidade</div>
    <button class="help-action-btn" onclick="navigate('privacy')">Abrir →</button>
  </div>
</div>`,
            en: `<p>Quickly access the main app functions:</p>
<div class="help-action-grid">
  <div class="help-action-card"><div class="help-action-icon">💸</div><div class="help-action-label">New Transaction</div><button class="help-action-btn" onclick="navigate('transactions');setTimeout(()=>typeof openTransactionModal==='function'&&openTransactionModal(),400)">Open →</button></div>
  <div class="help-action-card"><div class="help-action-icon">🏦</div><div class="help-action-label">New Account</div><button class="help-action-btn" onclick="navigate('accounts');setTimeout(()=>typeof openAccountModal==='function'&&openAccountModal(),400)">Open →</button></div>
  <div class="help-action-card"><div class="help-action-icon">📊</div><div class="help-action-label">Reports</div><button class="help-action-btn" onclick="navigate('reports')">Open →</button></div>
  <div class="help-action-card"><div class="help-action-icon">🔒</div><div class="help-action-label">Privacy Policy</div><button class="help-action-btn" onclick="navigate('privacy')">Open →</button></div>
</div>`,
            es: `<p>Accede rápidamente a las funciones principales:</p>
<div class="help-action-grid">
  <div class="help-action-card"><div class="help-action-icon">💸</div><div class="help-action-label">Nueva Transacción</div><button class="help-action-btn" onclick="navigate('transactions')">Abrir →</button></div>
  <div class="help-action-card"><div class="help-action-icon">🏦</div><div class="help-action-label">Nueva Cuenta</div><button class="help-action-btn" onclick="navigate('accounts')">Abrir →</button></div>
  <div class="help-action-card"><div class="help-action-icon">📊</div><div class="help-action-label">Informes</div><button class="help-action-btn" onclick="navigate('reports')">Abrir →</button></div>
</div>`,
            fr: `<p>Accédez rapidement aux fonctions principales:</p>
<div class="help-action-grid">
  <div class="help-action-card"><div class="help-action-icon">💸</div><div class="help-action-label">Nouvelle Transaction</div><button class="help-action-btn" onclick="navigate('transactions')">Ouvrir →</button></div>
  <div class="help-action-card"><div class="help-action-icon">📊</div><div class="help-action-label">Rapports</div><button class="help-action-btn" onclick="navigate('reports')">Ouvrir →</button></div>
</div>`,
          },
        },
      ],
    },
    {
      id: 'security', icon: '🔒', color: '#1d4ed8',
      title: { pt: 'Segurança & Privacidade', en: 'Security & Privacy', es: 'Seguridad y privacidad', fr: 'Sécurité et confidentialité' },
      articles: [
        {
          id: 'data-security',
          title: { pt: 'Como seus dados estão protegidos', en: 'How your data is protected', es: 'Cómo están protegidos sus datos', fr: 'Comment vos données sont protégées' },
          body: {
            pt: `<div style="background:linear-gradient(135deg,#1e3a5f,#1d4ed8);border-radius:14px;padding:20px;color:#fff;margin-bottom:18px;text-align:center">
  <div style="font-size:2.5rem;margin-bottom:8px">🔒</div>
  <div style="font-size:1.05rem;font-weight:800;margin-bottom:4px">Seus dados estão seguros</div>
  <div style="font-size:.8rem;opacity:.85">Infraestrutura enterprise-grade, criptografia ponta-a-ponta e controle total nas suas mãos.</div>
</div>
<div class="help-card-grid">
  <div class="help-mini-card" style="border-left:3px solid #1d4ed8">
    <strong>🔐 Criptografia TLS</strong>
    Toda comunicação entre o app e o servidor é protegida por TLS 1.3, o mesmo padrão dos maiores bancos do mundo.
  </div>
  <div class="help-mini-card" style="border-left:3px solid #16a34a">
    <strong>🏦 Supabase (PostgreSQL)</strong>
    Dados armazenados no Supabase, plataforma cloud com certificações SOC 2 e ISO 27001. Seus dados nunca são compartilhados com terceiros.
  </div>
  <div class="help-mini-card" style="border-left:3px solid #7c3aed">
    <strong>🛡️ Row Level Security (RLS)</strong>
    Cada família acessa apenas os seus próprios dados. Políticas de segurança no banco de dados impedem qualquer acesso cruzado entre famílias.
  </div>
  <div class="help-mini-card" style="border-left:3px solid #f59e0b">
    <strong>🔑 Autenticação JWT</strong>
    Senhas nunca são armazenadas em texto puro. O sistema usa tokens JWT com expiração automática e hash bcrypt para senhas.
  </div>
  <div class="help-mini-card" style="border-left:3px solid #0891b2">
    <strong>📱 PWA Offline-First</strong>
    O app funciona offline e sincroniza apenas quando conectado. Nenhum dado financeiro trafega desnecessariamente.
  </div>
  <div class="help-mini-card" style="border-left:3px solid #dc2626">
    <strong>🗑️ Direito ao Esquecimento</strong>
    Você pode solicitar a exclusão completa de todos os seus dados a qualquer momento, conforme a LGPD.
    <br><br><button class="help-action-btn" onclick="navigate('privacy')">Ver Política de Privacidade →</button>
  </div>
</div>
<h4>🌍 Conformidade legal</h4>
<ul>
  <li><strong>LGPD</strong> (Lei Geral de Proteção de Dados) — Brasil</li>
  <li><strong>GDPR</strong> — União Europeia</li>
  <li>Supabase é <strong>SOC 2 Type II</strong> certificado</li>
  <li>Backups automáticos com retenção de 7 dias</li>
</ul>
<h4>🔍 Transparência</h4>
<p>O Family FinTrack é uma aplicação de código aberto para uso familiar. O proprietário da família tem acesso a logs de auditoria completos de todas as operações realizadas no sistema.</p>
<div class="help-tip">💡 Dica: ative a autenticação em dois fatores (2FA) no seu provedor de email para uma camada extra de segurança no login.</div>
<div style="margin-top:16px;text-align:center">
  <button class="help-action-btn" onclick="navigate('privacy')" style="padding:10px 24px;font-size:.85rem">📄 Ver Política de Privacidade completa →</button>
</div>`,
            en: `<div style="background:linear-gradient(135deg,#1e3a5f,#1d4ed8);border-radius:14px;padding:20px;color:#fff;margin-bottom:18px;text-align:center">
  <div style="font-size:2.5rem;margin-bottom:8px">🔒</div>
  <div style="font-size:1.05rem;font-weight:800;margin-bottom:4px">Your data is secure</div>
  <div style="font-size:.8rem;opacity:.85">Enterprise-grade infrastructure, end-to-end encryption and full control in your hands.</div>
</div>
<div class="help-card-grid">
  <div class="help-mini-card" style="border-left:3px solid #1d4ed8"><strong>🔐 TLS Encryption</strong> All communication is protected by TLS 1.3.</div>
  <div class="help-mini-card" style="border-left:3px solid #16a34a"><strong>🏦 Supabase (PostgreSQL)</strong> SOC 2 and ISO 27001 certified cloud platform.</div>
  <div class="help-mini-card" style="border-left:3px solid #7c3aed"><strong>🛡️ Row Level Security</strong> Each family only accesses its own data.</div>
  <div class="help-mini-card" style="border-left:3px solid #f59e0b"><strong>🔑 JWT Authentication</strong> Passwords are never stored in plain text.</div>
</div>
<div style="margin-top:16px;text-align:center">
  <button class="help-action-btn" onclick="navigate('privacy')" style="padding:10px 24px">📄 View full Privacy Policy →</button>
</div>`,
            es: `<div style="background:linear-gradient(135deg,#1e3a5f,#1d4ed8);border-radius:14px;padding:20px;color:#fff;margin-bottom:18px;text-align:center">
  <div style="font-size:2.5rem;margin-bottom:8px">🔒</div>
  <div style="font-size:1.05rem;font-weight:800">Sus datos están seguros</div>
</div>
<div class="help-card-grid">
  <div class="help-mini-card" style="border-left:3px solid #1d4ed8"><strong>🔐 Cifrado TLS</strong> Toda comunicación protegida por TLS 1.3.</div>
  <div class="help-mini-card" style="border-left:3px solid #16a34a"><strong>🏦 Supabase</strong> Plataforma certificada SOC 2.</div>
  <div class="help-mini-card" style="border-left:3px solid #7c3aed"><strong>🛡️ RLS</strong> Cada familia accede solo a sus propios datos.</div>
</div>`,
            fr: `<div style="background:linear-gradient(135deg,#1e3a5f,#1d4ed8);border-radius:14px;padding:20px;color:#fff;margin-bottom:18px;text-align:center">
  <div style="font-size:2.5rem;margin-bottom:8px">🔒</div>
  <div style="font-size:1.05rem;font-weight:800">Vos données sont sécurisées</div>
</div>
<div class="help-card-grid">
  <div class="help-mini-card" style="border-left:3px solid #1d4ed8"><strong>🔐 Chiffrement TLS</strong> Toutes les communications protégées par TLS 1.3.</div>
  <div class="help-mini-card" style="border-left:3px solid #16a34a"><strong>🏦 Supabase</strong> Plateforme certifiée SOC 2.</div>
</div>`,
          },
        },
        {
          id: 'my-rights',
          title: { pt: 'Seus direitos sobre seus dados', en: 'Your data rights', es: 'Sus derechos sobre sus datos', fr: 'Vos droits sur vos données' },
          body: {
            pt: `<h4>📋 Seus direitos (LGPD / GDPR)</h4>
<div class="help-card-grid">
  <div class="help-mini-card" style="border-left:3px solid #1d4ed8">
    <strong>👁️ Direito de Acesso</strong>
    Você pode visualizar todos os seus dados a qualquer momento usando os recursos de Relatórios e Exportação do app.
    <br><br><button class="help-action-btn" onclick="navigate('reports')">Ver Relatórios →</button>
  </div>
  <div class="help-mini-card" style="border-left:3px solid #16a34a">
    <strong>✏️ Direito de Retificação</strong>
    Edite qualquer dado diretamente no app — transações, perfil, membros — sem precisar entrar em contato conosco.
  </div>
  <div class="help-mini-card" style="border-left:3px solid #dc2626">
    <strong>🗑️ Direito ao Apagamento</strong>
    Solicite a exclusão completa de todos os dados da sua família. O processo é irreversível e atende à LGPD.
    <br><br><button class="help-action-btn" onclick="navigate('privacy')" style="border-color:#dc2626;color:#dc2626">Solicitar exclusão →</button>
  </div>
  <div class="help-mini-card" style="border-left:3px solid #f59e0b">
    <strong>📤 Direito de Portabilidade</strong>
    Exporte todos os seus dados em formato CSV ou PDF a qualquer momento usando a função de Backup.
    <br><br><button class="help-action-btn" onclick="navigate('settings')">Ir para Backup →</button>
  </div>
</div>
<div class="help-warning" style="margin-top:12px">⚠️ A exclusão de dados é <strong>permanente e irreversível</strong>. Faça um backup antes de solicitar.</div>`,
            en: `<h4>📋 Your rights (GDPR)</h4>
<div class="help-card-grid">
  <div class="help-mini-card" style="border-left:3px solid #1d4ed8"><strong>👁️ Right of Access</strong> View all your data anytime using Reports and Export.</div>
  <div class="help-mini-card" style="border-left:3px solid #16a34a"><strong>✏️ Right of Rectification</strong> Edit any data directly in the app.</div>
  <div class="help-mini-card" style="border-left:3px solid #dc2626"><strong>🗑️ Right to Erasure</strong> Request complete deletion of all your family's data.<br><br><button class="help-action-btn" onclick="navigate('privacy')" style="border-color:#dc2626;color:#dc2626">Request deletion →</button></div>
  <div class="help-mini-card" style="border-left:3px solid #f59e0b"><strong>📤 Right to Portability</strong> Export all your data in CSV or PDF format anytime.</div>
</div>`,
            es: `<div class="help-card-grid">
  <div class="help-mini-card"><strong>👁️ Derecho de acceso</strong> Vea todos sus datos en cualquier momento.</div>
  <div class="help-mini-card"><strong>🗑️ Derecho al olvido</strong> Solicite la eliminación de todos sus datos.<br><br><button class="help-action-btn" onclick="navigate('privacy')">Solicitar eliminación →</button></div>
</div>`,
            fr: `<div class="help-card-grid">
  <div class="help-mini-card"><strong>👁️ Droit d'accès</strong> Consultez toutes vos données à tout moment.</div>
  <div class="help-mini-card"><strong>🗑️ Droit à l'effacement</strong> Demandez la suppression de toutes vos données.<br><br><button class="help-action-btn" onclick="navigate('privacy')">Demander la suppression →</button></div>
</div>`,
          },
        },
      ],
    },
  ];
}

// ══════════════════════════════════════════════════════════════════════════
//  RENDER ENGINE
// ══════════════════════════════════════════════════════════════════════════


// ── Financial literacy intro card ────────────────────────────────────────────
function _helpIntroCard(title, icon, body, color) {
  return `<div class="help-literacy-card" style="--lc:${color||'var(--accent)'}">
    <div class="help-literacy-icon">${icon}</div>
    <div class="help-literacy-body">
      <div class="help-literacy-title">${title}</div>
      <div class="help-literacy-text">${body}</div>
    </div>
  </div>`;
}


function _helpResolveBody(raw) {
  if (typeof raw !== 'string' || !raw.includes('_helpIntroCard(')) return raw || '';

  const prefix = '_helpIntroCard(';
  const start = raw.indexOf(prefix);
  if (start !== 0) return raw;

  const args = [];
  let i = prefix.length;
  while (i < raw.length && args.length < 4) {
    while (i < raw.length && /\s/.test(raw[i])) i++;
    const quote = raw[i];
    if (quote !== "'" && quote !== '"') return raw;
    i++;
    let val = '';
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '\\') {
        if (i + 1 < raw.length) val += raw[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) break;
      val += ch;
      i++;
    }
    if (raw[i] !== quote) return raw;
    args.push(val);
    i++;
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (args.length < 4) {
      if (raw[i] !== ',') return raw;
      i++;
    }
  }

  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (raw[i] !== ')') return raw;
  i++;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (raw.slice(i, i + 1) !== '+') return raw;
  i++;

  const [title, icon, body, color] = args;
  const rest = raw.slice(i).trim();
  return _helpIntroCard(title, icon, body, color) + rest;
}


function initHelpPage() {
  const page = document.getElementById('page-help');
  if (!page) return;

  // Preserve the page title bar and FX bar injected by navigate('help').
  const existingHeader = page.querySelector(':scope > .page-header-bar');
  const existingFxBar = page.querySelector(':scope > #fxRatesBadge, :scope > .fx-bar');

  // Remove only the dynamic help shell/content, never the preserved header/fx nodes.
  Array.from(page.children).forEach((child) => {
    if (child === existingHeader || child === existingFxBar) return;
    child.remove();
  });

  const shell = document.createElement('div');
  shell.className = 'help-shell';
  shell.innerHTML = `
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
      </main>`;

  // Rebuild the page in the correct order: title bar, FX bar, help shell.
  if (existingHeader && existingHeader.parentElement !== page) page.appendChild(existingHeader);
  if (existingHeader && page.firstElementChild !== existingHeader) page.insertBefore(existingHeader, page.firstChild);
  if (existingFxBar) {
    existingFxBar.style.display = '';
    if (existingHeader?.nextSibling) page.insertBefore(existingFxBar, existingHeader.nextSibling);
    else page.appendChild(existingFxBar);
  }
  page.appendChild(shell);

  _helpRenderNav();
  helpShowHome();

  // Mobile: tap nav header to expand/collapse
  const navHeader = shell.querySelector('.help-nav-header');
  if (navHeader) {
    navHeader.addEventListener('click', () => {
      const nav = shell.querySelector('.help-nav');
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
      ${sections.slice(0,8).map(s => `
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
      <div class="help-article-body">${_helpResolveBody(_ht(art.body))}</div>
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
