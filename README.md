# COMPRA TUDO

Mercearia com stock próprio (dark store) em Luanda. A interface está em português, francês e inglês. O catálogo traz os 1000 produtos do ficheiro, com **stock e preços de demonstração** para se poder testar a compra. A gestão altera stock e preços; a guarda de margem recusa vender abaixo do custo mais a margem mínima.

## Experimentar

1. Abra a loja. O catálogo só aparece depois do nome, do telemóvel angolano e do código de 6 dígitos.
2. Neste ambiente o SMS e o WhatsApp não estão ligados a um operador: o código aparece no ecrã. Ninguém da equipa o pede por telefone.
3. A área da equipa está no fim da conta, ou em `/gestao`.

Contas de demonstração (a palavra-passe não é mostrada nesta página nem no ecrã da gestão; fica só na variável `STAFF_PASSWORD` do servidor). Depois entra o código de dois passos, que neste ambiente de teste aparece no ecrã:

| E-mail | Papel |
| --- | --- |
| gestao@compratudo.ao | admin |
| stock@compratudo.ao | stock |
| financeiro@compratudo.ao | finanças |
| operacao@compratudo.ao | operação |

Um `operator` não cria descontos. Um `stock_manager` não muda preços. Cada alteração de preço ou stock fica na auditoria.

## Notas

- Os preços de demonstração não vêm do catálogo original (que não traz preços). Servem só para testar e podem ser substituídos na gestão.
- Sem fotografia real, o produto mostra as iniciais e o nome do ficheiro `SKU.jpg`. Não há fotos de outros retalhistas.
- Pagamento electrónico é simulado. Numerário fica a cobrar na entrega.
- Entrega dentro de cerca de 18 km da dark store em Talatona. Cacuaco fica de fora, de propósito.
