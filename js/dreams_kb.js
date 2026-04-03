/* ═══════════════════════════════════════════════════════════════════════════
   dreams_kb.js — Base de Conhecimento para o Módulo de Sonhos
   
   Fornece referências de preços, destinos, tipos de imóveis e automóveis
   para enriquecer as sugestões do wizard de sonhos sem depender de IA/API.
   
   Fontes: valores médios de mercado brasileiro (2024–2025),
   FIPE, SECOVI, IBGE, dados de portais de viagem e imóveis.
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// VIAGENS — Destinos, Passagens, Hotéis, Pacotes
// ════════════════════════════════════════════════════════════════════════════

const DRM_KB_DESTINOS = {
  // ── Brasil ────────────────────────────────────────────────────────────────
  brasil: [
    {
      destino: 'Fernando de Noronha', uf: 'PE', tipo: 'praia', categoria: 'premium',
      passagem_media: { sao_paulo: 1200, rio_janeiro: 1100, belo_horizonte: 1400, brasilia: 1300 },
      hotel_noite: { econômico: 280, medio: 520, luxo: 1200 },
      taxa_preservacao_diaria: 130,
      estadia_recomendada_dias: 5,
      melhor_epoca: ['fev', 'mar', 'set', 'out', 'nov'],
      atrações: ['Baía dos Porcos', 'Praia do Sancho', 'Mergulho', 'Snorkel'],
      custo_medio_casal_7dias: 12000,
      notas: 'Taxa de Preservação Ambiental obrigatória (~R$130/dia). Voos geralmente com conexão em Recife.',
    },
    {
      destino: 'Gramado', uf: 'RS', tipo: 'serra', categoria: 'médio-alto',
      passagem_media: { sao_paulo: 600, rio_janeiro: 750, belo_horizonte: 700 },
      hotel_noite: { econômico: 200, medio: 380, luxo: 850 },
      estadia_recomendada_dias: 4,
      melhor_epoca: ['jun', 'jul', 'ago', 'dez'],
      atrações: ['Natal Luz', 'Canela', 'Snowland', 'Mini Mundo', 'Lago Negro'],
      custo_medio_casal_7dias: 7000,
      notas: 'Alta temporada em julho (Festival de Cinema) e dezembro (Natal Luz) eleva preços 40-60%.',
    },
    {
      destino: 'Florianópolis', uf: 'SC', tipo: 'praia', categoria: 'médio',
      passagem_media: { sao_paulo: 350, rio_janeiro: 550, belo_horizonte: 500, brasilia: 600 },
      hotel_noite: { econômico: 180, medio: 320, luxo: 700 },
      estadia_recomendada_dias: 7,
      melhor_epoca: ['dez', 'jan', 'fev', 'mar'],
      atrações: ['Lagoa da Conceição', 'Praia Mole', 'Jurerê Internacional', 'Ribeirão da Ilha'],
      custo_medio_casal_7dias: 6500,
    },
    {
      destino: 'Bonito', uf: 'MS', tipo: 'ecoturismo', categoria: 'médio-alto',
      passagem_media: { sao_paulo: 900, rio_janeiro: 1100, belo_horizonte: 1000, brasilia: 700 },
      hotel_noite: { econômico: 250, medio: 420, luxo: 900 },
      estadia_recomendada_dias: 5,
      melhor_epoca: ['abr', 'mai', 'jun', 'jul', 'ago', 'set'],
      atrações: ['Gruta do Lago Azul', 'Rio Sucuri', 'Abismo Anhumas', 'Buraco das Araras'],
      pacotes_atrações_por_dia: 350,
      custo_medio_casal_7dias: 9000,
      notas: 'Todas as atrações exigem voucher antecipado. Cotar pacotes com agências locais.',
    },
    {
      destino: 'Salvador', uf: 'BA', tipo: 'praia_cultura', categoria: 'médio',
      passagem_media: { sao_paulo: 450, rio_janeiro: 380, belo_horizonte: 420, brasilia: 350 },
      hotel_noite: { econômico: 150, medio: 280, luxo: 600 },
      estadia_recomendada_dias: 5,
      melhor_epoca: ['set', 'out', 'nov', 'dez', 'jan'],
      atrações: ['Pelourinho', 'Mercado Modelo', 'Barra', 'Morro de São Paulo'],
      custo_medio_casal_7dias: 5500,
    },
    {
      destino: 'Lençóis Maranhenses', uf: 'MA', tipo: 'natureza', categoria: 'médio',
      passagem_media: { sao_paulo: 800, rio_janeiro: 850, belo_horizonte: 900, brasilia: 700 },
      hotel_noite: { econômico: 200, medio: 350, luxo: 700 },
      estadia_recomendada_dias: 4,
      melhor_epoca: ['jul', 'ago', 'set'],
      atrações: ['Dunas com lagoas', 'Lagoa Azul', 'Lagoa Bonita', 'Atins'],
      custo_medio_casal_7dias: 7500,
      notas: 'Melhor época é entre julho e setembro, quando as lagoas estão cheias.',
    },
    {
      destino: 'Chapada dos Veadeiros', uf: 'GO', tipo: 'ecoturismo', categoria: 'baixo-médio',
      passagem_media: { sao_paulo: 500, rio_janeiro: 600, belo_horizonte: 400, brasilia: 150 },
      hotel_noite: { econômico: 130, medio: 220, luxo: 450 },
      estadia_recomendada_dias: 4,
      melhor_epoca: ['abr', 'mai', 'jun', 'jul', 'ago', 'set'],
      atrações: ['Cânion Rio Preto', 'Vale da Lua', 'Cachoeira Santa Bárbara', 'Trilhas'],
      custo_medio_casal_7dias: 4500,
    },
    {
      destino: 'Jericoacoara', uf: 'CE', tipo: 'praia', categoria: 'médio',
      passagem_media: { sao_paulo: 650, rio_janeiro: 700, belo_horizonte: 720, brasilia: 600 },
      hotel_noite: { econômico: 200, medio: 380, luxo: 800 },
      estadia_recomendada_dias: 5,
      melhor_epoca: ['jul', 'ago', 'set', 'out', 'nov'],
      atrações: ['Duna do Pôr do Sol', 'Lagoa do Paraíso', 'Pedra Furada', 'Kitesurf'],
      custo_medio_casal_7dias: 6500,
      notas: 'Acesso é por jipe (2h de Jijoca). Considerar transfer no orçamento.',
    },
    {
      destino: 'Rio de Janeiro', uf: 'RJ', tipo: 'praia_cultura', categoria: 'médio',
      passagem_media: { sao_paulo: 280, belo_horizonte: 250, brasilia: 400, curitiba: 350 },
      hotel_noite: { econômico: 200, medio: 380, luxo: 900 },
      estadia_recomendada_dias: 5,
      melhor_epoca: ['abr', 'mai', 'set', 'out', 'nov'],
      atrações: ['Cristo Redentor', 'Pão de Açúcar', 'Copacabana', 'Ipanema', 'Santa Teresa'],
      custo_medio_casal_7dias: 6000,
      notas: 'Evitar fevereiro (Carnaval — preços 2-3x mais altos).',
    },
    {
      destino: 'Pantanal', uf: 'MT/MS', tipo: 'ecoturismo', categoria: 'alto',
      passagem_media: { sao_paulo: 700, rio_janeiro: 800, brasilia: 600 },
      hotel_noite: { econômico: 400, medio: 700, luxo: 1800 }, // lodges com pensão completa
      estadia_recomendada_dias: 5,
      melhor_epoca: ['jul', 'ago', 'set', 'out'],
      atrações: ['Safari de onças', 'Observação de araras', 'Pesca esportiva', 'Boat safari'],
      custo_medio_casal_7dias: 14000,
      notas: 'Lodges geralmente com pensão completa. Época seca (jul-out) melhor para onças.',
    },
  ],

  // ── Internacional ─────────────────────────────────────────────────────────
  internacional: [
    {
      destino: 'Lisboa', pais: 'Portugal', continente: 'Europa',
      passagem_media_brl: { sao_paulo: 4800, rio_janeiro: 5200, brasilia: 5500 },
      hotel_noite_brl: { econômico: 280, medio: 550, luxo: 1400 },
      estadia_recomendada_dias: 7,
      melhor_epoca: ['abr', 'mai', 'jun', 'set', 'out'],
      atrações: ['Alfama', 'Torre de Belém', 'Sintra', 'Cascais', 'Jerónimos'],
      custo_medio_casal_7dias_brl: 16000,
      notas: 'Sem necessidade de visto para brasileiros (até 90 dias). Voos diretos de SP e RJ.',
    },
    {
      destino: 'Buenos Aires', pais: 'Argentina', continente: 'América do Sul',
      passagem_media_brl: { sao_paulo: 1800, rio_janeiro: 2100, curitiba: 1600 },
      hotel_noite_brl: { econômico: 150, medio: 280, luxo: 700 },
      estadia_recomendada_dias: 5,
      melhor_epoca: ['mar', 'abr', 'mai', 'out', 'nov'],
      atrações: ['Puerto Madero', 'San Telmo', 'Recoleta', 'La Boca', 'Tigre'],
      custo_medio_casal_7dias_brl: 8500,
      notas: 'Câmbio oficial vs. blue dollar — pagar em dólares físicos pode reduzir custo significativamente.',
    },
    {
      destino: 'Cancún + Riviera Maya', pais: 'México', continente: 'América Central',
      passagem_media_brl: { sao_paulo: 4500, rio_janeiro: 5000 },
      hotel_noite_brl: { econômico: 350, medio: 700, luxo: 1800 },
      estadia_recomendada_dias: 7,
      melhor_epoca: ['nov', 'dez', 'jan', 'fev', 'mar', 'abr'],
      atrações: ['Chichén Itzá', 'Tulum', 'Playa del Carmen', 'Cenotes', 'Cozumel'],
      custo_medio_casal_7dias_brl: 15000,
      notas: 'All-inclusive é comum e pode ser mais econômico. Furacões possíveis jun-oct.',
    },
    {
      destino: 'Orlando', pais: 'EUA', continente: 'América do Norte',
      passagem_media_brl: { sao_paulo: 5200, rio_janeiro: 5800 },
      hotel_noite_brl: { econômico: 280, medio: 550, luxo: 1500 },
      estadia_recomendada_dias: 10,
      melhor_epoca: ['jan', 'fev', 'set', 'out', 'nov'],
      atrações: ['Walt Disney World', 'Universal Studios', 'SeaWorld', 'Busch Gardens'],
      ingresso_parques_por_dia_brl: 600,
      custo_medio_casal_7dias_brl: 18000,
      notas: 'Ingressos de parques comprar com antecedência. Évitar jul e dez (muito cheio e caro).',
    },
    {
      destino: 'Machu Picchu', pais: 'Peru', continente: 'América do Sul',
      passagem_media_brl: { sao_paulo: 3500, rio_janeiro: 3800, brasilia: 4000 },
      hotel_noite_brl: { econômico: 200, medio: 400, luxo: 1100 },
      estadia_recomendada_dias: 7,
      melhor_epoca: ['mai', 'jun', 'jul', 'ago', 'set'],
      atrações: ['Machu Picchu', 'Cusco', 'Valle Sagrado', 'Lago Titicaca', 'Rainbow Mountain'],
      ingresso_machu_picchu_brl: 400,
      custo_medio_casal_7dias_brl: 11000,
      notas: 'Ingressos para Machu Picchu com capacidade limitada — comprar com meses de antecedência.',
    },
    {
      destino: 'Paris', pais: 'França', continente: 'Europa',
      passagem_media_brl: { sao_paulo: 6500, rio_janeiro: 7000 },
      hotel_noite_brl: { econômico: 500, medio: 1000, luxo: 3000 },
      estadia_recomendada_dias: 7,
      melhor_epoca: ['abr', 'mai', 'set', 'out'],
      atrações: ['Torre Eiffel', 'Louvre', 'Versalhes', 'Montmartre', 'Museu d\'Orsay'],
      custo_medio_casal_7dias_brl: 22000,
      notas: 'Passagem pelo metrô é barata. Jantar em bistrôs locais reduz custo. Evitar agosto (lotado).',
    },
    {
      destino: 'Tóquio', pais: 'Japão', continente: 'Ásia',
      passagem_media_brl: { sao_paulo: 9000, rio_janeiro: 9500 },
      hotel_noite_brl: { econômico: 300, medio: 600, luxo: 1800 },
      estadia_recomendada_dias: 10,
      melhor_epoca: ['mar', 'abr', 'out', 'nov'],
      atrações: ['Shibuya', 'Shinjuku', 'Kyoto', 'Monte Fuji', 'Nara', 'Osaka'],
      jr_pass_7dias_brl: 2200,
      custo_medio_casal_7dias_brl: 22000,
      notas: 'JR Pass economiza muito em transporte. Refeições podem ser baratas (lanchonetes R$30-50).',
    },
    {
      destino: 'Dubai', pais: 'Emirados Árabes', continente: 'Ásia',
      passagem_media_brl: { sao_paulo: 6000, rio_janeiro: 6500 },
      hotel_noite_brl: { econômico: 400, medio: 900, luxo: 3500 },
      estadia_recomendada_dias: 5,
      melhor_epoca: ['out', 'nov', 'dez', 'jan', 'fev', 'mar'],
      atrações: ['Burj Khalifa', 'Dubai Mall', 'Palm Jumeirah', 'Desert Safari', 'Dubai Frame'],
      custo_medio_casal_7dias_brl: 20000,
      notas: 'Verão (mai-set) extremamente quente (50°C). Período de Ramadã pode limitar atividades.',
    },
    {
      destino: 'Cidade do Cabo', pais: 'África do Sul', continente: 'África',
      passagem_media_brl: { sao_paulo: 7500, rio_janeiro: 8000 },
      hotel_noite_brl: { econômico: 250, medio: 500, luxo: 1500 },
      estadia_recomendada_dias: 10,
      melhor_epoca: ['nov', 'dez', 'jan', 'fev', 'mar'],
      atrações: ['Table Mountain', 'Cape Point', 'Boulders Beach (pinguins)', 'Winelands', 'Garden Route'],
      safari_1dia_brl: 1500,
      custo_medio_casal_7dias_brl: 16000,
    },
    {
      destino: 'Bali', pais: 'Indonésia', continente: 'Ásia',
      passagem_media_brl: { sao_paulo: 7000, rio_janeiro: 7500 },
      hotel_noite_brl: { econômico: 150, medio: 350, luxo: 1200 },
      estadia_recomendada_dias: 10,
      melhor_epoca: ['abr', 'mai', 'jun', 'jul', 'ago', 'set'],
      atrações: ['Ubud', 'Tanah Lot', 'Tegallalang', 'Seminyak', 'Nusa Penida'],
      custo_medio_casal_7dias_brl: 15000,
      notas: 'Visa on arrival disponível para brasileiros. Custo de vida local muito baixo.',
    },
    {
      destino: 'Nova York', pais: 'EUA', continente: 'América do Norte',
      passagem_media_brl: { sao_paulo: 5500, rio_janeiro: 6000 },
      hotel_noite_brl: { econômico: 700, medio: 1400, luxo: 4000 },
      estadia_recomendada_dias: 7,
      melhor_epoca: ['abr', 'mai', 'set', 'out'],
      atrações: ['Central Park', 'Times Square', 'Statue of Liberty', 'Metropolitan Museum', 'Brooklyn Bridge'],
      custo_medio_casal_7dias_brl: 24000,
      notas: 'Hotel é o maior custo. Hostels ou apartamentos Airbnb em Manhattan podem economizar.',
    },
  ],
};

// ── Custos típicos de viagem por categoria ────────────────────────────────
const DRM_KB_CUSTOS_VIAGEM = {
  passagem: {
    descricao: 'Passagem aérea ida e volta',
    obs: 'Valores médios. Antecipar 3-6 meses economiza 20-40%.',
  },
  hotel: {
    descricao: 'Hospedagem por noite (por pessoa)',
    categorias: { econômico: 'Hostel/Airbnb básico', medio: 'Hotel 3-4 estrelas', luxo: 'Hotel 5 estrelas / resort' },
  },
  alimentacao_dia_brl: {
    baixo: 80,    // lanchonetes / mercado
    medio: 180,   // restaurantes intermediários
    alto: 350,    // restaurantes bons / turísticos
  },
  transporte_local_dia_brl: {
    baixo: 30,    // transporte público
    medio: 80,    // uber/taxi eventual
    alto: 200,    // transfers / passeios
  },
  atracoes_passeios_dia_brl: {
    baixo: 50,
    medio: 150,
    alto: 350,
  },
  seguro_viagem_semana: {
    america_sul: 180,
    europa: 280,
    eua_canada: 420,
    asia: 320,
    mundial: 380,
  },
};

// ── Componentes típicos de custo para cada tipo de viagem ─────────────────
const DRM_KB_COMPONENTES_VIAGEM = {
  viagem: {
    praia_brasil: [
      { nome: 'Passagens aéreas (2 pessoas)', pct_total: 0.25 },
      { nome: 'Hospedagem', pct_total: 0.30 },
      { nome: 'Alimentação', pct_total: 0.18 },
      { nome: 'Passeios e atrações', pct_total: 0.12 },
      { nome: 'Transporte local / aluguel de carro', pct_total: 0.08 },
      { nome: 'Seguro viagem', pct_total: 0.03 },
      { nome: 'Despesas extras (compras, souvenirs)', pct_total: 0.04 },
    ],
    europa: [
      { nome: 'Passagens aéreas (2 pessoas)', pct_total: 0.30 },
      { nome: 'Hospedagem', pct_total: 0.28 },
      { nome: 'Alimentação e bares', pct_total: 0.16 },
      { nome: 'Passeios, museus e ingressos', pct_total: 0.10 },
      { nome: 'Transporte (trem, metrô, uber)', pct_total: 0.07 },
      { nome: 'Seguro viagem', pct_total: 0.03 },
      { nome: 'Compras e souvenirs', pct_total: 0.06 },
    ],
    eua: [
      { nome: 'Passagens aéreas (2 pessoas)', pct_total: 0.25 },
      { nome: 'Hospedagem', pct_total: 0.30 },
      { nome: 'Ingressos parques / atrações', pct_total: 0.18 },
      { nome: 'Alimentação', pct_total: 0.12 },
      { nome: 'Carro alugado ou transporte', pct_total: 0.08 },
      { nome: 'Seguro viagem', pct_total: 0.04 },
      { nome: 'Compras (outlets, duty-free)', pct_total: 0.03 },
    ],
  },
};

// ════════════════════════════════════════════════════════════════════════════
// AUTOMÓVEIS — Preços, segmentos e custos
// ════════════════════════════════════════════════════════════════════════════

const DRM_KB_AUTOMOVEIS = {
  // Fonte: Tabela FIPE aproximada 2024-2025
  segmentos: {
    hatch_entrada: {
      label: 'Hatch de Entrada', exemplos: ['Argo', 'Polo', 'HB20', 'Onix'],
      faixa_preco: { min: 75000, medio: 90000, max: 115000 },
      custo_ipva_anual_pct: 0.04,
      custo_seguro_anual: 3500,
      revisao_anual: 1800,
      combustivel_km: 0.28, // R$/km
    },
    suv_compacto: {
      label: 'SUV Compacto', exemplos: ['Creta', 'T-Cross', 'HR-V', 'Tracker'],
      faixa_preco: { min: 120000, medio: 155000, max: 195000 },
      custo_ipva_anual_pct: 0.04,
      custo_seguro_anual: 5500,
      revisao_anual: 2400,
      combustivel_km: 0.35,
    },
    suv_medio: {
      label: 'SUV Médio', exemplos: ['Tiguan', 'Compass', 'Corolla Cross', 'Territory'],
      faixa_preco: { min: 195000, medio: 240000, max: 310000 },
      custo_ipva_anual_pct: 0.04,
      custo_seguro_anual: 8000,
      revisao_anual: 3500,
      combustivel_km: 0.40,
    },
    picape: {
      label: 'Picape', exemplos: ['Hilux', 'Ranger', 'S10', 'Saveiro'],
      faixa_preco: { min: 165000, medio: 260000, max: 380000 },
      custo_ipva_anual_pct: 0.04,
      custo_seguro_anual: 7000,
      revisao_anual: 3200,
      combustivel_km: 0.48,
    },
    sedan_executivo: {
      label: 'Sedan Executivo', exemplos: ['Corolla', 'Civic', 'Jetta'],
      faixa_preco: { min: 130000, medio: 165000, max: 210000 },
      custo_ipva_anual_pct: 0.04,
      custo_seguro_anual: 5200,
      revisao_anual: 2600,
      combustivel_km: 0.30,
    },
    suv_luxo: {
      label: 'SUV de Luxo', exemplos: ['BMW X5', 'Mercedes GLE', 'Audi Q7', 'Volvo XC90'],
      faixa_preco: { min: 520000, medio: 750000, max: 1200000 },
      custo_ipva_anual_pct: 0.04,
      custo_seguro_anual: 18000,
      revisao_anual: 8000,
      combustivel_km: 0.55,
    },
    eletrico: {
      label: 'Elétrico', exemplos: ['BYD Dolphin', 'Volvo C40', 'BMW iX', 'Model 3'],
      faixa_preco: { min: 170000, medio: 320000, max: 850000 },
      custo_ipva_anual_pct: 0.02, // isenção parcial em vários estados
      custo_seguro_anual: 6000,
      revisao_anual: 900, // muito menor
      combustivel_km: 0.08, // custo elétrico
    },
  },
  financiamento: {
    taxas_cef: 1.49, // % a.m. (Caixa, 2025)
    taxas_banco_brasil: 1.69,
    taxas_itau: 1.79,
    taxas_bradesco: 1.85,
    taxas_santander: 1.92,
    prazo_max_meses: 60,
    entrada_minima_recomendada_pct: 0.30,
    obs: 'Financiar mais de 70% do valor aumenta muito o custo total. Sempre calcular o CET.',
  },
  custos_mensais_possuir: {
    descricao: 'Custo médio mensal de posse além da parcela',
    obs: 'Incluir IPVA, seguro, combustível e manutenção no planejamento',
    hatch: 1200,
    suv_compacto: 1800,
    suv_medio: 2600,
    picape: 2400,
    luxo: 5500,
    eletrico: 1000,
  },
  documentacao: {
    emplacamento: { min: 800, max: 2500, obs: 'Varia por estado e valor do veículo' },
    transferencia: { min: 400, max: 1200 },
    ipva_primeiro_ano_pct: 0.04,
  },
};

// ════════════════════════════════════════════════════════════════════════════
// IMÓVEIS — Preços por cidade e tipo
// ════════════════════════════════════════════════════════════════════════════

const DRM_KB_IMOVEIS = {
  // Fonte: SECOVI, Zap Imóveis, QuintoAndar 2024-2025
  // Preços em R$/m² para apartamentos
  preco_m2_apartamento: {
    sao_paulo: {
      label: 'São Paulo (SP)',
      bairros: {
        jardins_faria_lima: { min: 18000, medio: 24000, max: 40000 },
        pinheiros_vila_madalena: { min: 14000, medio: 18000, max: 26000 },
        brooklin_itaim: { min: 15000, medio: 20000, max: 32000 },
        moema_ibirapuera: { min: 13000, medio: 17000, max: 24000 },
        tatuape_morumbi: { min: 9000, medio: 12000, max: 16000 },
        zona_leste: { min: 5500, medio: 7500, max: 11000 },
        grande_sp: { min: 4000, medio: 6000, max: 9000 },
      },
      media_cidade: 11500,
    },
    rio_janeiro: {
      label: 'Rio de Janeiro (RJ)',
      bairros: {
        ipanema_leblon: { min: 18000, medio: 25000, max: 45000 },
        barra_da_tijuca: { min: 9000, medio: 13000, max: 20000 },
        botafogo_flamengo: { min: 12000, medio: 16000, max: 22000 },
        copacabana: { min: 11000, medio: 14000, max: 20000 },
        zona_norte: { min: 4000, medio: 6000, max: 9000 },
      },
      media_cidade: 10800,
    },
    belo_horizonte: {
      label: 'Belo Horizonte (MG)',
      bairros: {
        savassi_funcionarios: { min: 10000, medio: 13000, max: 18000 },
        buritis_vila_da_serra: { min: 8000, medio: 11000, max: 15000 },
        pampulha: { min: 6000, medio: 8500, max: 12000 },
        nordeste_venda_nova: { min: 3500, medio: 5000, max: 7500 },
      },
      media_cidade: 8000,
    },
    curitiba: {
      label: 'Curitiba (PR)',
      bairros: {
        batel_agua_verde: { min: 9000, medio: 12000, max: 18000 },
        bigorrilho_mercês: { min: 7500, medio: 10000, max: 14000 },
        portao_portão: { min: 5500, medio: 7500, max: 10000 },
        sitio_cercado: { min: 3500, medio: 5000, max: 7000 },
      },
      media_cidade: 8200,
    },
    porto_alegre: {
      label: 'Porto Alegre (RS)',
      bairros: {
        moinhos_bela_vista: { min: 9000, medio: 12000, max: 18000 },
        petrópolis_boa_vista: { min: 7000, medio: 9500, max: 14000 },
        centro_histórico: { min: 5000, medio: 7000, max: 10000 },
        zona_sul: { min: 4000, medio: 5500, max: 8000 },
      },
      media_cidade: 7500,
    },
    brasilia: {
      label: 'Brasília (DF)',
      bairros: {
        lago_sul_norte: { min: 12000, medio: 18000, max: 32000 },
        asa_sul_norte: { min: 7000, medio: 10000, max: 15000 },
        sudoeste_octogonal: { min: 8500, medio: 11000, max: 16000 },
        taguatinga_samambaia: { min: 3500, medio: 5000, max: 7500 },
      },
      media_cidade: 9000,
    },
    florianopolis: {
      label: 'Florianópolis (SC)',
      bairros: {
        jurerê_canasvieiras: { min: 12000, medio: 18000, max: 30000 },
        lagoa_da_conceição: { min: 10000, medio: 14000, max: 22000 },
        centro_trindade: { min: 7000, medio: 10000, max: 14000 },
        sul_da_ilha: { min: 5000, medio: 8000, max: 12000 },
      },
      media_cidade: 10500,
    },
    fortaleza: {
      label: 'Fortaleza (CE)',
      bairros: {
        meireles_aldeota: { min: 7000, medio: 9500, max: 14000 },
        cocó_varjota: { min: 6000, medio: 8000, max: 12000 },
        montese_messejana: { min: 3500, medio: 5000, max: 7500 },
      },
      media_cidade: 6500,
    },
    salvador: {
      label: 'Salvador (BA)',
      bairros: {
        barra_ondina: { min: 8000, medio: 11000, max: 16000 },
        pituba_costa_azul: { min: 7000, medio: 9500, max: 13000 },
        imbuí_pernambués: { min: 4500, medio: 6000, max: 9000 },
      },
      media_cidade: 7000,
    },
    interior_sp: {
      label: 'Interior de SP (Campinas, Sorocaba, Ribeirão Preto)',
      media_cidade: 5500,
      min: 3500, max: 9000,
    },
  },

  // Custos adicionais na compra
  custos_compra: {
    itbi_pct: 0.03,        // Imposto — varia por município (2-4%)
    escritura_pct: 0.015,  // Custo aproximado
    registro_pct: 0.01,    // Custo aproximado
    corretor_pct: 0.06,    // Comissão do corretor (paga pelo vendedor, mas afeta negociação)
    vistoria: 800,
    despachante: 1500,
    mudança: { local: 1500, interestadual: 4500 },
    reforma_entrada: { basica: 8000, media: 25000, completa: 70000 },
  },

  // Financiamento
  financiamento: {
    caixa_taxa_mensal: 0.72, // % a.m. (SFH, 2025 aproximado)
    itau_taxa_mensal: 0.78,
    bradesco_taxa_mensal: 0.79,
    santander_taxa_mensal: 0.82,
    entrada_minima_sfh: 0.20, // 20%
    entrada_ideal: 0.30,       // 30% (reduz consideravelmente o custo)
    prazo_max_anos: 35,
    limite_sfh_2025: 1500000,  // limite de financiamento pelo SFH
    obs: 'FGTS pode ser usado como entrada ou amortização no SFH.',
  },

  // Custos mensais de posse
  custos_mensais_posse: {
    condominio_m2_estimado: 12,  // R$/m² por mês (apartamentos)
    iptu_valor_venal_pct_anual: 0.0100, // varia muito por município
    seguro_incendio_mensal: 80,
    manutencao_reserva_mensal_pct_valor: 0.0005, // 0,05% do valor/mês
  },
};

// ════════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE CONSULTA E SUGESTÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Busca destinos de viagem por termos de busca (nome, país, tipo)
 */
function drmKbBuscarDestino(termo) {
  const t = (termo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const todos = [
    ...(DRM_KB_DESTINOS.brasil   || []),
    ...(DRM_KB_DESTINOS.internacional || []),
  ];
  return todos.filter(d => {
    const campos = [d.destino, d.pais, d.uf, d.tipo, ...(d.atrações || [])].join(' ')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return campos.includes(t);
  });
}
window.drmKbBuscarDestino = drmKbBuscarDestino;

/**
 * Retorna destinos recomendados para um perfil de viagem
 */
function drmKbRecomendarDestinos({ tipo, orcamento_casal, pessoas = 2, dias = 7 }) {
  const todos = [
    ...(DRM_KB_DESTINOS.brasil   || []),
    ...(DRM_KB_DESTINOS.internacional || []),
  ];
  return todos
    .filter(d => {
      if (tipo && d.tipo !== tipo) return false;
      const custo = d.custo_medio_casal_7dias_brl || d.custo_medio_casal_7dias;
      if (orcamento_casal && custo > orcamento_casal * 1.2) return false;
      return true;
    })
    .sort((a, b) => {
      const ca = a.custo_medio_casal_7dias_brl || a.custo_medio_casal_7dias || 0;
      const cb = b.custo_medio_casal_7dias_brl || b.custo_medio_casal_7dias || 0;
      return ca - cb;
    });
}
window.drmKbRecomendarDestinos = drmKbRecomendarDestinos;

/**
 * Gera componentes de custo para uma viagem com base na KB local
 * Usado pelo wizard para sugerir itens SEM precisar da IA
 */
function drmKbGerarComponentesViagem({ destino, pessoas = 2, dias = 7, orcamento_total, cidade_origem = 'sao_paulo' }) {
  // Procurar destino na KB
  const todos = [...(DRM_KB_DESTINOS.brasil || []), ...(DRM_KB_DESTINOS.internacional || [])];
  const dest  = todos.find(d => d.destino.toLowerCase().includes((destino || '').toLowerCase()));

  const componentes = [];

  if (dest) {
    const cidadeKey = cidade_origem.toLowerCase().replace(/\s/g, '_').replace(/[áàã]/g, 'a').replace(/[éê]/g, 'e').replace(/[í]/g, 'i').replace(/[óô]/g, 'o').replace(/[ú]/g, 'u');
    const passagem  = dest.passagem_media?.[cidadeKey] || dest.passagem_media_brl?.[cidadeKey];
    const hotel_med = dest.hotel_noite?.medio || dest.hotel_noite_brl?.medio;

    if (passagem) {
      componentes.push({ nome: `Passagens aéreas (${pessoas} pessoas)`, valor: Math.round(passagem * pessoas * 1.05) });
    }
    if (hotel_med) {
      componentes.push({ nome: `Hospedagem (${dias} noites)`, valor: Math.round(hotel_med * dias) });
    }
    if (dest.taxa_preservacao_diaria) {
      componentes.push({ nome: 'Taxa de preservação ambiental', valor: Math.round(dest.taxa_preservacao_diaria * dias * pessoas) });
    }
    if (dest.ingresso_parques_por_dia_brl) {
      componentes.push({ nome: 'Ingressos parques / atrações', valor: Math.round(dest.ingresso_parques_por_dia_brl * dias * pessoas) });
    }
    if (dest.jr_pass_7dias_brl) {
      componentes.push({ nome: 'JR Pass (trem no Japão)', valor: Math.round(dest.jr_pass_7dias_brl * pessoas) });
    }
  }

  // Completar com componentes genéricos
  const custo_al  = DRM_KB_CUSTOS_VIAGEM.alimentacao_dia_brl.medio;
  const custo_trp = DRM_KB_CUSTOS_VIAGEM.transporte_local_dia_brl.medio;
  const custo_atr = DRM_KB_CUSTOS_VIAGEM.atracoes_passeios_dia_brl.medio;
  const seg_sem   = DRM_KB_CUSTOS_VIAGEM.seguro_viagem_semana.america_sul;

  componentes.push({ nome: `Alimentação (${dias} dias, ${pessoas} pessoas)`, valor: Math.round(custo_al * dias * pessoas) });
  componentes.push({ nome: `Transporte local (${dias} dias)`,                valor: Math.round(custo_trp * dias) });
  if (!dest?.atrações?.length) {
    componentes.push({ nome: `Passeios e atrações (${dias} dias)`,           valor: Math.round(custo_atr * dias * pessoas) });
  }
  componentes.push({ nome: 'Seguro viagem',  valor: Math.round(seg_sem * (Math.ceil(dias / 7))) });
  componentes.push({ nome: 'Despesas extras', valor: Math.round((orcamento_total || 10000) * 0.05) });

  // Ajustar proporcionalmente ao orçamento se fornecido
  if (orcamento_total) {
    const totalAtual = componentes.reduce((s, c) => s + c.valor, 0);
    if (totalAtual > 0) {
      const fator = orcamento_total / totalAtual;
      componentes.forEach(c => { c.valor = Math.round(c.valor * fator); });
    }
  }

  return componentes.map(c => ({ nome: c.nome, valor_estimado: c.valor }));
}
window.drmKbGerarComponentesViagem = drmKbGerarComponentesViagem;

/**
 * Gera componentes de custo para compra de automóvel
 */
function drmKbGerarComponentesAutomovel({ valor_veiculo, tipo_compra = 'avista', entrada_pct = 0.30 }) {
  const entrada        = Math.round(valor_veiculo * entrada_pct);
  const custos_doc     = Math.round(valor_veiculo * 0.025); // IPVA + emplacamento + transferência
  const seguro_ano1    = Math.round(valor_veiculo * 0.025);  // ~2.5% do valor
  const revisao_ano1   = 2000;
  const acessorios     = Math.round(valor_veiculo * 0.02);   // tapetes, película, etc.

  const componentes = [];

  if (tipo_compra === 'avista') {
    componentes.push({ nome: 'Valor do veículo',              valor_estimado: valor_veiculo });
  } else {
    componentes.push({ nome: 'Entrada (entrada inicial)',      valor_estimado: entrada });
    componentes.push({ nome: 'Reserva para parcelas (6 meses)',valor_estimado: Math.round((valor_veiculo - entrada) / 48 * 6) });
  }
  componentes.push({ nome: 'Emplacamento e documentação',    valor_estimado: custos_doc });
  componentes.push({ nome: 'Seguro (1º ano)',                 valor_estimado: seguro_ano1 });
  componentes.push({ nome: 'Revisão e manutenção (1º ano)',   valor_estimado: revisao_ano1 });
  componentes.push({ nome: 'Acessórios e personalização',     valor_estimado: acessorios });

  return componentes;
}
window.drmKbGerarComponentesAutomovel = drmKbGerarComponentesAutomovel;

/**
 * Gera componentes de custo para compra de imóvel
 */
function drmKbGerarComponentesImovel({ valor_imovel, tipo_compra = 'avista', entrada_pct = 0.30, incluir_reforma = false }) {
  const entrada   = Math.round(valor_imovel * entrada_pct);
  const itbi      = Math.round(valor_imovel * DRM_KB_IMOVEIS.custos_compra.itbi_pct);
  const cartorio  = Math.round(valor_imovel * (DRM_KB_IMOVEIS.custos_compra.escritura_pct + DRM_KB_IMOVEIS.custos_compra.registro_pct));
  const vistoria  = DRM_KB_IMOVEIS.custos_compra.vistoria;
  const mudança   = DRM_KB_IMOVEIS.custos_compra.mudança.local;
  const reforma   = incluir_reforma ? DRM_KB_IMOVEIS.custos_compra.reforma_entrada.media : 0;

  const componentes = [];
  if (tipo_compra === 'avista') {
    componentes.push({ nome: 'Valor do imóvel',              valor_estimado: valor_imovel });
  } else {
    componentes.push({ nome: 'Entrada (financiamento)',       valor_estimado: entrada });
    componentes.push({ nome: 'Reserva para parcelas (6 meses)', valor_estimado: Math.round((valor_imovel - entrada) * 0.006 * 6) });
  }
  componentes.push({ nome: 'ITBI (imposto)',                  valor_estimado: itbi });
  componentes.push({ nome: 'Cartório (escritura + registro)', valor_estimado: cartorio });
  componentes.push({ nome: 'Vistoria e laudos',               valor_estimado: vistoria });
  if (reforma) {
    componentes.push({ nome: 'Reforma e melhorias',           valor_estimado: reforma });
  }
  componentes.push({ nome: 'Mudança',                         valor_estimado: mudança });
  componentes.push({ nome: 'Mobília e eletrodomésticos',      valor_estimado: Math.round(valor_imovel * 0.04) });

  return componentes;
}
window.drmKbGerarComponentesImovel = drmKbGerarComponentesImovel;

/**
 * Estima o valor total de um sonho com base em parâmetros e KB
 */
function drmKbEstimarValor(tipo, params) {
  if (tipo === 'viagem') {
    const dest = drmKbBuscarDestino(params.destino || '');
    if (dest.length) {
      const d = dest[0];
      const custo = d.custo_medio_casal_7dias_brl || d.custo_medio_casal_7dias || 0;
      const fatorPessoas = (params.pessoas || 2) / 2;
      const fatorDias = (params.dias || 7) / 7;
      return Math.round(custo * fatorPessoas * fatorDias);
    }
    // fallback: estimativa genérica
    return 8000;
  }
  if (tipo === 'automovel') {
    const seg = Object.values(DRM_KB_AUTOMOVEIS.segmentos)
      .find(s => s.exemplos.some(e => e.toLowerCase().includes((params.modelo || '').toLowerCase())));
    return seg ? seg.faixa_preco.medio : 120000;
  }
  if (tipo === 'imovel') {
    const cidade = params.cidade?.toLowerCase().replace(/\s/g, '_') || 'interior_sp';
    const precos = DRM_KB_IMOVEIS.preco_m2_apartamento;
    const cidadeData = Object.values(precos).find(c =>
      c.label?.toLowerCase().includes(cidade) || Object.keys(precos).some(k => k.includes(cidade))
    );
    const m2 = cidadeData?.media_cidade || 8000;
    const area = params.area_m2 || 70;
    return Math.round(m2 * area);
  }
  return 0;
}
window.drmKbEstimarValor = drmKbEstimarValor;

// Expor a KB completa para uso interno do módulo
window.DRM_KB = {
  destinos:     DRM_KB_DESTINOS,
  custos_viagem: DRM_KB_CUSTOS_VIAGEM,
  componentes_viagem: DRM_KB_COMPONENTES_VIAGEM,
  automoveis:   DRM_KB_AUTOMOVEIS,
  imoveis:      DRM_KB_IMOVEIS,
};
