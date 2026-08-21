export type CardType = "noun" | "verb" | "adjective" | "adverb";

export type NounGender = "masculine" | "feminine";

export type NounArticleProfile =
  | { definiteSingular: true; definitePlural: true; indefiniteSingular: true }
  | { definiteSingular: true; definitePlural: false; indefiniteSingular: false }
  | { definiteSingular: false; definitePlural: true; indefiniteSingular: false }
  | { definiteSingular: false; definitePlural: false; indefiniteSingular: false };

export type NounDetails = {
  rule: string;
  base: string;
  gender: NounGender;
  articleProfile: NounArticleProfile;
};

export type VerbDetails = {
  io: string;
  tu: string;
  luiLei: string;
  noi: string;
  voi: string;
  loro: string;
  auxiliary: "avere" | "essere";
  participle: string;
};

export type AdjectiveDetails = {
  masculineSingular: string;
  feminineSingular: string;
  masculinePlural: string;
  femininePlural: string;
};

export type AdverbDetails = Record<string, never>;

type CardBase<Type extends CardType, Details> = {
  id: number;
  type: Type;
  english: string;
  italian: string;
  setName: string | null;
  tags: string[];
  details: Details;
};

export type NounCard = CardBase<"noun", NounDetails>;
export type VerbCard = CardBase<"verb", VerbDetails>;
export type AdjectiveCard = CardBase<"adjective", AdjectiveDetails>;
export type AdverbCard = CardBase<"adverb", AdverbDetails>;

export type Flashcard = NounCard | VerbCard | AdjectiveCard | AdverbCard;
