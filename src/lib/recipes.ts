import type { Lang } from "@/lib/shop-types";

type Copy = Record<Lang, string>;

export type Recipe = {
  photo: string;
  title: Copy;
  steps: Copy;
  skus: string[];
};

const dish = (photo: string, title: Copy, steps: Copy, skus: string[]): Recipe => ({ photo, title, steps, skus });

const RULES: { aisle: "meat" | "fish"; match: RegExp; recipe: Recipe }[] = [
  {
    aisle: "meat",
    match: /picad|hamb[uú]rguer/i,
    recipe: dish(
      "/receitas/picado.jpg",
      { pt: "Esparguete com carne picada", fr: "Spaghetti à la viande hachée", en: "Spaghetti with minced beef" },
      {
        pt: "Refogue a cebola no óleo, junte a carne picada e o tomate. Tempere com sal e piri-piri. Sirva sobre o esparguete.",
        fr: "Faites revenir l'oignon dans l'huile, ajoutez la viande et la tomate. Salez, ajoutez le piri-piri et servez sur les spaghetti.",
        en: "Fry the onion in oil, add the mince and tomato. Season with salt and chilli. Serve over spaghetti.",
      },
      ["MER-0097", "FRE-0043", "FRE-0041", "MER-0067", "MER-0167", "MER-0154"],
    ),
  },
  {
    aisle: "meat",
    match: /chouri[cç]o|salsicha|bacon/i,
    recipe: dish(
      "/receitas/feijao.jpg",
      { pt: "Feijão com enchido", fr: "Haricots à la charcuterie", en: "Beans with sausage" },
      {
        pt: "Coza o feijão. Noutra panela, doure o enchido com cebola e óleo, junte o tomate e o feijão. Acerte o sal.",
        fr: "Cuisez les haricots. Faites dorer la charcuterie avec l'oignon et l'huile, ajoutez la tomate puis les haricots.",
        en: "Boil the beans. Brown the sausage with onion and oil, add tomato, then the beans. Season with salt.",
      },
      ["MER-0049", "FRE-0043", "FRE-0041", "MER-0067", "MER-0167"],
    ),
  },
  {
    aisle: "meat",
    match: /porco.*cubos|cubos.*porco/i,
    recipe: dish(
      "/receitas/estufado.jpg",
      { pt: "Carne de porco estufada com batata", fr: "Porc mijoté aux pommes de terre", en: "Braised pork with potato" },
      {
        pt: "Sele os cubos de porco no óleo. Junte cebola, tomate, alho e piri-piri. Acrescente a batata e deixe apurar. Sirva com arroz.",
        fr: "Saisissez les cubes de porc. Ajoutez oignon, tomate, ail et piri-piri, puis les pommes de terre. Servez avec du riz.",
        en: "Sear the pork cubes. Add onion, tomato, garlic and chilli, then the potato. Serve with rice.",
      },
      ["FRE-0046", "FRE-0043", "FRE-0041", "MER-0160", "MER-0154", "MER-0001", "MER-0067", "MER-0167"],
    ),
  },
  {
    aisle: "meat",
    match: /porco|febra|entrecosto/i,
    recipe: dish(
      "/receitas/costeletas.jpg",
      { pt: "Costeletas com batata e feijão", fr: "Côtelettes, pommes de terre et haricots", en: "Chops with potato and beans" },
      {
        pt: "Tempere a carne com alho, sal e limão. Sele no óleo. Sirva com a batata cozida e uma tigela de feijão.",
        fr: "Assaisonnez avec ail, sel et citron. Saisissez dans l'huile. Servez avec pommes de terre et haricots.",
        en: "Season with garlic, salt and lemon. Sear in oil. Serve with boiled potato and beans.",
      },
      ["FRE-0046", "MER-0049", "MER-0160", "FRE-0011", "MER-0167", "MER-0067"],
    ),
  },
  {
    aisle: "meat",
    match: /vaca|empanar|cubos|alcatra|ossobuco|cabrito|alm[oô]ndega/i,
    recipe: dish(
      "/receitas/estufado.jpg",
      { pt: "Carne estufada com batata", fr: "Viande mijotée aux pommes de terre", en: "Braised meat with potato" },
      {
        pt: "Sele a carne no óleo. Junte cebola, tomate, alho e piri-piri. Acrescente a batata e deixe apurar. Sirva com arroz.",
        fr: "Saisissez la viande. Ajoutez oignon, tomate, ail et piri-piri, puis les pommes de terre. Servez avec du riz.",
        en: "Sear the meat. Add onion, tomato, garlic and chilli, then the potato. Serve with rice.",
      },
      ["FRE-0046", "FRE-0043", "FRE-0041", "MER-0160", "MER-0154", "MER-0001", "MER-0067", "MER-0167"],
    ),
  },
  {
    aisle: "meat",
    match: /moela|f[ií]gado de frango|mi[uú]dos/i,
    recipe: dish(
      "/receitas/estufado.jpg",
      { pt: "Moelas e miúdos de frango estufados", fr: "Gésiers et abats de poulet mijotés", en: "Braised chicken gizzards and giblets" },
      {
        pt: "Lave os miúdos e tempere com alho, sal e limão. Refogue cebola e tomate no óleo, junte os miúdos e deixe apurar em lume brando. Sirva com arroz.",
        fr: "Lavez les abats, assaisonnez avec ail, sel et citron. Faites revenir oignon et tomate, ajoutez les abats et laissez mijoter. Servez avec du riz.",
        en: "Rinse the giblets and season with garlic, salt and lemon. Fry onion and tomato, add the giblets and simmer. Serve with rice.",
      },
      ["MER-0001", "FRE-0043", "FRE-0041", "MER-0067", "MER-0167", "FRE-0011"],
    ),
  },
  {
    aisle: "meat",
    match: /frango|peito|coxa|asa|moela|f[ií]gado de frango|mi[uú]dos/i,
    recipe: dish(
      "/receitas/frango.jpg",
      { pt: "Frango grelhado com arroz", fr: "Poulet grillé et riz", en: "Grilled chicken with rice" },
      {
        pt: "Tempere o frango com limão, alho e sal. Grelhe até ficar dourado. Sirva com arroz e tomate.",
        fr: "Assaisonnez le poulet au citron, à l'ail et au sel. Grillez-le. Servez avec du riz et de la tomate.",
        en: "Season the chicken with lemon, garlic and salt. Grill it. Serve with rice and tomato.",
      },
      ["MER-0001", "FRE-0011", "MER-0160", "MER-0167", "MER-0067", "FRE-0041"],
    ),
  },
  {
    aisle: "fish",
    match: /peixe seco|sortido|carapau seco/i,
    recipe: dish(
      "/receitas/seco.jpg",
      { pt: "Peixe seco com feijão", fr: "Poisson séché aux haricots", en: "Dried fish with beans" },
      {
        pt: "Demolhe o peixe seco. Refogue cebola e tomate no óleo, junte o peixe e o feijão e deixe apurar.",
        fr: "Dessalez le poisson. Faites revenir oignon et tomate, ajoutez le poisson et les haricots.",
        en: "Soak the dried fish. Fry onion and tomato, add the fish and the beans and simmer.",
      },
      ["MER-0049", "FRE-0043", "FRE-0041", "MER-0067", "MER-0167"],
    ),
  },
  {
    aisle: "fish",
    match: /bacalhau/i,
    recipe: dish(
      "/receitas/bacalhau.jpg",
      { pt: "Bacalhau com batata e cebola", fr: "Morue, pommes de terre et oignon", en: "Salt cod with potato and onion" },
      {
        pt: "Demolhe o bacalhau se ainda estiver seco. Coza-o com batata. Desfie, misture com cebola, alho e azeite.",
        fr: "Dessalez la morue si besoin. Cuisez-la avec les pommes de terre. Effilochez, ajoutez oignon, ail et huile.",
        en: "Soak the cod if it is still dry. Boil it with potato. Flake it and mix with onion, garlic and oil.",
      },
      ["FRE-0046", "FRE-0043", "MER-0160", "MER-0076", "MER-0167"],
    ),
  },
  {
    aisle: "fish",
    match: /sardinha/i,
    recipe: dish(
      "/receitas/sardinha.jpg",
      { pt: "Sardinhas assadas com limão", fr: "Sardines grillées au citron", en: "Grilled sardines with lemon" },
      {
        pt: "Tempere as sardinhas com sal e alho. Asse ou grelhe. Sirva com limão e pão.",
        fr: "Salez les sardines, ajoutez l'ail et grillez-les. Servez avec citron et pain.",
        en: "Season the sardines with salt and garlic. Grill them. Serve with lemon and bread.",
      },
      ["FRE-0011", "MER-0160", "MER-0167", "MER-0067", "PAD-0001"],
    ),
  },
  {
    aisle: "fish",
    match: /carapau|chicharro/i,
    recipe: dish(
      "/receitas/carapau.jpg",
      { pt: "Carapau frito com arroz", fr: "Chinchard frit et riz", en: "Fried mackerel with rice" },
      {
        pt: "Tempere o carapau com limão, alho e sal. Frite no óleo. Sirva com arroz e tomate.",
        fr: "Assaisonnez au citron, à l'ail et au sel. Faites frire. Servez avec riz et tomate.",
        en: "Season with lemon, garlic and salt. Fry in oil. Serve with rice and tomato.",
      },
      ["MER-0001", "FRE-0011", "MER-0160", "MER-0167", "MER-0067", "FRE-0041"],
    ),
  },
  {
    aisle: "fish",
    match: /corvina/i,
    recipe: dish(
      "/receitas/corvina.jpg",
      { pt: "Corvina grelhada com arroz", fr: "Courbine grillée et riz", en: "Grilled croaker with rice" },
      {
        pt: "Tempere a corvina com limão, alho e sal. Grelhe dos dois lados. Sirva com arroz.",
        fr: "Assaisonnez au citron, à l'ail et au sel. Grillez des deux côtés. Servez avec du riz.",
        en: "Season with lemon, garlic and salt. Grill both sides. Serve with rice.",
      },
      ["MER-0001", "FRE-0011", "MER-0160", "MER-0167", "MER-0067"],
    ),
  },
  {
    aisle: "fish",
    match: /pescada/i,
    recipe: dish(
      "/receitas/pescada.jpg",
      { pt: "Pescada cozida com batata", fr: "Merlu bouilli et pommes de terre", en: "Poached hake with potato" },
      {
        pt: "Coza a batata. Junte a pescada, o alho e o limão e deixe cozer em lume brando. Acerte o sal.",
        fr: "Cuisez les pommes de terre. Ajoutez le merlu, l'ail et le citron à feu doux.",
        en: "Boil the potato. Add the hake, garlic and lemon and simmer. Season with salt.",
      },
      ["FRE-0046", "MER-0160", "FRE-0011", "MER-0167", "MER-0067"],
    ),
  },
  {
    aisle: "fish",
    match: /camar[aã]o/i,
    recipe: dish(
      "/receitas/camarao.jpg",
      { pt: "Camarão de alho com arroz", fr: "Crevettes à l'ail et riz", en: "Garlic prawns with rice" },
      {
        pt: "Salteie o camarão no óleo com alho e limão. Tempere com sal e piri-piri. Sirva com arroz.",
        fr: "Faites sauter les crevettes avec ail et citron. Salez, ajoutez le piri-piri et le riz.",
        en: "Sauté the prawns in oil with garlic and lemon. Season and serve with rice.",
      },
      ["MER-0001", "MER-0160", "FRE-0011", "MER-0154", "MER-0067", "MER-0167"],
    ),
  },
  {
    aisle: "fish",
    match: /lula/i,
    recipe: dish(
      "/receitas/lulas.jpg",
      { pt: "Lulas grelhadas com arroz", fr: "Calamars grillés et riz", en: "Grilled squid with rice" },
      {
        pt: "Grelhe as lulas pouco tempo, com alho, limão e sal. Sirva com arroz.",
        fr: "Grillez les calamars brièvement avec ail, citron et sel. Servez avec du riz.",
        en: "Grill the squid briefly with garlic, lemon and salt. Serve with rice.",
      },
      ["MER-0001", "MER-0160", "FRE-0011", "MER-0167", "MER-0067"],
    ),
  },
  {
    aisle: "fish",
    match: /polvo/i,
    recipe: dish(
      "/receitas/polvo.jpg",
      { pt: "Polvo com batata", fr: "Poulpe et pommes de terre", en: "Octopus with potato" },
      {
        pt: "Coza o polvo até ficar macio. Sirva com batata, azeite, alho e sal.",
        fr: "Cuisez le poulpe jusqu'à ce qu'il soit tendre. Servez avec pommes de terre, huile et ail.",
        en: "Boil the octopus until tender. Serve with potato, oil, garlic and salt.",
      },
      ["FRE-0046", "MER-0076", "MER-0160", "MER-0167"],
    ),
  },
  {
    aisle: "fish",
    match: /am[eê]ijoa/i,
    recipe: dish(
      "/receitas/ameijoas.jpg",
      { pt: "Amêijoas ao alho", fr: "Palourdes à l'ail", en: "Clams with garlic" },
      {
        pt: "Abra as amêijoas no óleo com alho. Junte limão e sal. Sirva de imediato.",
        fr: "Ouvrez les palourdes dans l'huile et l'ail. Ajoutez citron et sel.",
        en: "Open the clams in oil with garlic. Add lemon and salt. Serve at once.",
      },
      ["MER-0067", "MER-0160", "FRE-0011", "MER-0167"],
    ),
  },
  {
    aisle: "fish",
    match: /caranguejo/i,
    recipe: dish(
      "/receitas/caranguejo.jpg",
      { pt: "Caranguejo cozido com limão", fr: "Crabe bouilli au citron", en: "Boiled crab with lemon" },
      {
        pt: "Coza o caranguejo em água com sal. Sirva partido, com limão.",
        fr: "Cuisez le crabe à l'eau salée. Servez décortiqué, avec du citron.",
        en: "Boil the crab in salted water. Serve it cracked, with lemon.",
      },
      ["MER-0167", "FRE-0011"],
    ),
  },
  {
    aisle: "fish",
    match: /marisco/i,
    recipe: dish(
      "/receitas/marisco.jpg",
      { pt: "Arroz de marisco", fr: "Riz aux fruits de mer", en: "Seafood rice" },
      {
        pt: "Refogue cebola e alho, junte o marisco e o tomate e cozinhe o arroz no mesmo tacho.",
        fr: "Faites revenir oignon et ail, ajoutez les fruits de mer, la tomate et le riz.",
        en: "Fry onion and garlic, add the seafood and tomato, and cook the rice in the same pot.",
      },
      ["MER-0001", "FRE-0043", "MER-0160", "FRE-0041", "MER-0067", "MER-0167"],
    ),
  },
  {
    aisle: "fish",
    match: /filete|varinha|empanado|hamb[uú]rguer(es)? de peixe|postas de peixe/i,
    recipe: dish(
      "/receitas/filetes.jpg",
      { pt: "Filetes fritos com arroz", fr: "Filets frits et riz", en: "Fried fillets with rice" },
      {
        pt: "Tempere os filetes com limão e sal. Frite no óleo. Sirva com arroz.",
        fr: "Assaisonnez les filets au citron et au sel. Faites frire. Servez avec du riz.",
        en: "Season the fillets with lemon and salt. Fry them. Serve with rice.",
      },
      ["MER-0001", "FRE-0011", "MER-0167", "MER-0067"],
    ),
  },
  {
    aisle: "fish",
    match: /til[aá]pia/i,
    recipe: dish(
      "/receitas/tilapia.jpg",
      { pt: "Tilápia grelhada com limão", fr: "Tilapia grillé au citron", en: "Grilled tilapia with lemon" },
      {
        pt: "Tempere a tilápia com limão, alho e sal. Grelhe. Sirva com arroz.",
        fr: "Assaisonnez au citron, à l'ail et au sel. Grillez. Servez avec du riz.",
        en: "Season with lemon, garlic and salt. Grill. Serve with rice.",
      },
      ["MER-0001", "FRE-0011", "MER-0160", "MER-0167", "MER-0067"],
    ),
  },
  {
    aisle: "fish",
    match: /bagre/i,
    recipe: dish(
      "/receitas/bagre.jpg",
      { pt: "Caldeirada de bagre", fr: "Ragoût de poisson-chat", en: "Catfish stew" },
      {
        pt: "Refogue cebola e tomate, junte o bagre em postas, a batata e o sal. Deixe apurar.",
        fr: "Faites revenir oignon et tomate, ajoutez le poisson, les pommes de terre et le sel.",
        en: "Fry onion and tomato, add the catfish, potato and salt, and simmer.",
      },
      ["FRE-0043", "FRE-0041", "FRE-0046", "MER-0067", "MER-0167"],
    ),
  },
  {
    aisle: "fish",
    match: /ca[cç][aã]o/i,
    recipe: dish(
      "/receitas/cacao.jpg",
      { pt: "Cação de cebolada", fr: "Roussette aux oignons", en: "Dogfish with onion" },
      {
        pt: "Sele as postas. Tape com muita cebola, tomate, alho e piri-piri. Deixe estufar.",
        fr: "Saisissez les darnes. Couvrez d'oignon, de tomate, d'ail et de piri-piri.",
        en: "Sear the steaks. Cover with onion, tomato, garlic and chilli and braise.",
      },
      ["FRE-0043", "FRE-0041", "MER-0160", "MER-0154", "MER-0067", "MER-0167"],
    ),
  },
  {
    aisle: "fish",
    match: /gato/i,
    recipe: dish(
      "/receitas/gatofunge.jpg",
      { pt: "Peixe gato frito com funge", fr: "Poisson-chat frit et foufou", en: "Fried catfish with fuba" },
      {
        pt: "Frite o peixe gato temperado com limão e sal. Prepare o funge com a fuba e sirva com tomate.",
        fr: "Faites frire le poisson au citron et au sel. Servez avec le foufou de maïs et la tomate.",
        en: "Fry the catfish seasoned with lemon and salt. Serve with maize fuba and tomato.",
      },
      ["MER-0025", "FRE-0011", "MER-0167", "MER-0067", "FRE-0041"],
    ),
  },
  {
    aisle: "fish",
    match: /cacusso/i,
    recipe: dish(
      "/receitas/cacusso.jpg",
      { pt: "Cacusso frito com arroz", fr: "Tilapia de rivière frit et riz", en: "Fried river tilapia with rice" },
      {
        pt: "O cacusso é o peixe preto de rio. Tempere com limão, alho e sal e frite. Sirva com arroz.",
        fr: "Le cacusso est un tilapia noir de rivière. Assaisonnez au citron, à l'ail et au sel, puis faites frire. Servez avec du riz.",
        en: "Cacusso is a black river tilapia. Season with lemon, garlic and salt and fry it. Serve with rice.",
      },
      ["MER-0001", "FRE-0011", "MER-0160", "MER-0167", "MER-0067"],
    ),
  },
  {
    aisle: "fish",
    match: /peixe/i,
    recipe: dish(
      "/receitas/peixe.jpg",
      { pt: "Peixe grelhado com arroz", fr: "Poisson grillé et riz", en: "Grilled fish with rice" },
      {
        pt: "Tempere o peixe com limão, alho e sal. Grelhe. Sirva com arroz e tomate.",
        fr: "Assaisonnez le poisson au citron, à l'ail et au sel. Grillez-le. Servez avec du riz et de la tomate.",
        en: "Season the fish with lemon, garlic and salt. Grill it. Serve with rice and tomato.",
      },
      ["MER-0001", "FRE-0011", "MER-0160", "MER-0167", "FRE-0041", "MER-0067"],
    ),
  },
];

const GENERIC_MEAT = dish(
  "/receitas/refogado.jpg",
  { pt: "Refogado deste fresco", fr: "Sauté de cette viande", en: "A simple braise" },
  {
    pt: "Sele a carne no óleo com cebola e alho. Junte o tomate e o sal e deixe apurar. Acompanhe com arroz.",
    fr: "Saisissez la viande avec oignon et ail. Ajoutez la tomate et le sel. Servez avec du riz.",
    en: "Sear the meat with onion and garlic. Add tomato and salt. Serve with rice.",
  },
  ["FRE-0043", "MER-0160", "FRE-0041", "MER-0167", "MER-0001", "MER-0067"],
);

export function matchRecipe(product: { sku: string; name: string; subcategoryId: string }): Recipe | null {
  const aisle = product.subcategoryId.includes("talho") || product.subcategoryId.includes("carne-congelada")
    ? "meat"
    : product.subcategoryId.includes("peixaria") || product.subcategoryId.includes("peixe")
      ? "fish"
      : null;
  if (!aisle) return null;
  const found = RULES.find((rule) => rule.aisle === aisle && rule.match.test(product.name))?.recipe ?? (aisle === "meat" ? GENERIC_MEAT : null);
  if (!found) return null;
  return { ...found, skus: [product.sku, ...found.skus.filter((sku) => sku !== product.sku)] };
}
