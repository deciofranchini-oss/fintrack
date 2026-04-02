# FinTrack — Patch de Melhorias UX Mobile + Categorias de Preços

## Arquivos modificados

| Arquivo | Destino no projeto |
|---|---|
| `index.html` | raiz do projeto |
| `css/style.css` | `css/style.css` |
| `js/prices.js` | `js/prices.js` |

## SQL

Execute o arquivo `fintrack_prices_hierarchy.sql` no **SQL Editor** do Supabase:
> Project → SQL Editor → New query → cole o conteúdo → Run

## O que foi alterado

### Mobile UX (`css/style.css`)
- **Transações**: botões em grid 2 colunas, filtros em coluna única
- **Programadas**: toggle de visualização full-width, botão "+ Programar" proeminente
- **Dívidas**: botões "Novo Lançamento" e "Nova Dívida" empilhados abaixo do título (não encobrem mais)
- **Beneficiários**: tabela convertida em lista compacta, chips de resumo com scroll horizontal

### Sistema de Categorias Hierárquicas de Preços (`js/prices.js` + `index.html`)
- Nova estrutura: **Categoria App → Subcategoria → Tipo**
- Persistência 100% via Supabase (`app_settings`) — sem localStorage
- Filtros em cascata: Categoria → Subcategoria → Tipo
- Novo agrupamento "Subcategoria" na barra de visualização
- Modal de item com seção "Classificação de Preços" para definir subcategoria e tipo
- Criação de subcategorias e tipos diretamente pelo usuário (prompt inline)
