export class CreditCardDetailsDto {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export class CreditCardHolderInfoDto {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
}

export class PayCreditCardDto {
  creditCard: CreditCardDetailsDto;
  creditCardHolderInfo: CreditCardHolderInfoDto;
}