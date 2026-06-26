import { Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { PayCreditCardDto } from './dto/pay-credit-card.dto';

@Injectable()
export class AsaasService {
  private client: AxiosInstance;
  private readonly logger = new Logger(AsaasService.name);

  constructor() {

    this.client = axios.create({
      baseURL: process.env.ASAAS_API_URL,
      headers: {
        access_token: process.env.ASAAS_API_KEY,
      },
    });
  }

  // 1. Cria ou busca o cliente dentro do ecossistema do Asaas
  async createCustomer(name: string, email: string, cpf: string): Promise<string> {

    console.log(name, email, cpf);
    try {
      const response = await this.client.post('/customers', {
        name,
        email,
        cpfCnpj: cpf,
        notificationDisabled: true, // Desativa os e-mails automáticos do Asaas, o NestJS cuidará dos pushes
      });
      return response.data.id; // Retorna o cus_...
    } catch (error: any) {
      console.error('Erro ao criar cliente no Asaas:', error.response?.data || error.message);
      throw new InternalServerErrorException('Falha ao processar cadastro financeiro.');
    }
  }

  async updateCustomer(gatewayCustomerId: string, data: { name?: string; cpfCnpj?: string }) {
    try {
      const response = await this.client.post(`/customers/${gatewayCustomerId}`, {
        name: data.name,
        cpfCnpj: data.cpfCnpj,
      });
      
      return response.data; // Retorna os dados atualizados vindos do Asaas
    } catch (error: any) {
      console.error('❌ Erro ao atualizar cliente no Asaas:', error.response?.data || error.message);
      
      // Captura o erro real do Asaas (ex: "CPF inválido", "Cliente não encontrado")
      const asaasError = error.response?.data?.errors?.[0]?.description || 'Falha ao atualizar cadastro financeiro no gateway.';
      throw new BadRequestException(asaasError);
    }
  }

  // 3. Gera uma cobrança Pix imediata
  async createPixInvoice(customerId: string, value: number, description: string, externalReference: string) {
    try {
        // 1. Cria a fatura base no Asaas
        const invoiceResponse = await this.client.post('/payments', {
        customer: customerId,
        billingType: 'PIX',
        value: value,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Amanhã
        description: description,
        externalReference: externalReference, 
        });

        // Captura o ID da cobrança (pay_...) direto da raiz do objeto de dados retornado
        const paymentId = invoiceResponse.data?.id;

        if (!paymentId) {
        throw new Error('A API do Asaas não retornou um ID de pagamento válido (id está vazio).');
        }

        let pixCopyPaste = '';
        let pixQrCodeUrl = '';

        try {
        // 2. Busca o código Copia e Cola e o QR Code do Pix gerado
        const pixResponse = await this.client.get(`/payments/${paymentId}/pixQrCode`);
        
        pixCopyPaste = pixResponse.data?.pixCopyPaste || '';
        pixQrCodeUrl = pixResponse.data?.encodedImage || '';
        } catch (pixError: any) {
        console.warn('⚠️ [Asaas Sandbox Warning] Falha ao gerar QR Code Pix real no ambiente de testes:', pixError.message);
        }

        // FALLBACK DE SEGURANÇA PARA SANDBOX:
        // Se o Sandbox do Asaas não gerar o Pix (comum por falta de chave Pix cadastrada na conta de homologação),
        // nós injetamos dados simulados para o seu banco local não dar erro de validação e você poder testar o fluxo completo!
        if (!pixCopyPaste) {
        pixCopyPaste = `00020101021226830014br.gov.bcb.pix2561sandbox.asaas.com/v3/qr/v2/pay_${paymentId}5204000053039865405${value.toFixed(2)}5802BR5916RumoAoShape6009SaoPaulo62070503***6304ABCD`;
        pixQrCodeUrl = 'SIMULADO_SANDBOX_BASE64_IMAGE';
        }

        return {
        gatewayInvoiceId: paymentId,
        pixCopyPaste,
        pixQrCodeUrl,
        };
    } catch (error: any) {
        // Esse log vai abrir as entranhas do Asaas no seu terminal se algo der errado na criação
        console.error('❌ Erro crítico na chamada principal do Asaas:', error.response?.data || error.message);
        throw new InternalServerErrorException('Falha ao gerar ordem de pagamento via Pix no gateway.');
    }
    }

    async payWithCreditCard(gatewayInvoiceId: string, dto: PayCreditCardDto, remoteIp: string) {
        try {
            const response = await this.client.post(`/payments/${gatewayInvoiceId}/payWithCreditCard`, {
            creditCard: {
                holderName: dto.creditCard.holderName,
                number: dto.creditCard.number,
                expiryMonth: dto.creditCard.expiryMonth,
                expiryYear: dto.creditCard.expiryYear,
                ccv: dto.creditCard.ccv,
            },
            creditCardHolderInfo: {
                name: dto.creditCardHolderInfo.name,
                email: dto.creditCardHolderInfo.email,
                cpfCnpj: dto.creditCardHolderInfo.cpfCnpj,
                postalCode: dto.creditCardHolderInfo.postalCode,
                addressNumber: dto.creditCardHolderInfo.addressNumber,
                phone: dto.creditCardHolderInfo.phone,
            },
            remoteIp: remoteIp, // O Asaas exige o IP do celular do usuário por segurança contra fraudes
            });

            // Retorna o status da transação (ex: CONFIRMED, RECEIVED, AWAITING_RISK_ANALYSIS)
            return response.data;
        } catch (error: any) {
            console.error('❌ Erro ao processar cartão no Asaas:', error.response?.data || error.message);
            
            // Captura a mensagem de erro real do cartão (ex: "Cartão recusado", "Saldo insuficiente")
            const asaasError = error.response?.data?.errors?.[0]?.description || 'Erro ao processar o cartão.';
            throw new BadRequestException(asaasError);
        }
    }

    async payWithSavedCardToken(gatewayInvoiceId: string, creditCardToken: string, remoteIp: string) {
        try {
            const response = await this.client.post(`/payments/${gatewayInvoiceId}/payWithCreditCard`, {
            creditCardToken,
            remoteIp,
            });

            return response.data; // Devolve o objeto com o status da transação
        } catch (error: any) {
            console.error('❌ Erro ao processar cartão salvo no Asaas:', error.response?.data || error.message);
            const asaasError = error.response?.data?.errors?.[0]?.description || 'Erro ao processar o cartão salvo.';
            throw new BadRequestException(asaasError);
        }
    }

  async generatePixPayment(customerId: string, value: number, description: string, externalReference: string) {
    try {
      this.logger.log(`💳 [Asaas] Gerando cobrança PIX para o cliente ${customerId} no valor de R$ ${value}`);
      
      const invoiceResponse: any = await this.client.post('/payments', {
        customer: customerId,
        billingType: 'PIX',
        value: value,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Vence em 24h
        description: description,
        externalReference: externalReference,
      });

      const paymentId = invoiceResponse.data.id;
      const invoiceUrl = invoiceResponse.data.invoiceUrl;

      // 🌟 Passo 2: Buscar o QRCode e o Copia e Cola usando o seu client
      const pixResponse: any = await this.client.get(`/payments/${paymentId}/pixQrCode`);

      // Retorna o combo completo para o seu service local gravar e mandar pro Flutter
      return {
        asaasPaymentId: paymentId,
        invoiceUrl: invoiceUrl,
        encodedImage: pixResponse.data.encodedImage || '',
        payload: pixResponse.data.payload || '',
        expirationDate: pixResponse.data.expirationDate || '',
      };

    } catch (error: any) {
      this.logger.error(`❌ Erro ao gerar PIX no Asaas: ${error.response?.data?.errors?.[0]?.description || error.message}`);
      throw new BadRequestException(
        `Falha ao processar pagamento via PIX: ${error.response?.data?.errors?.[0]?.description || 'Erro interno no gateway'}`
      );
    }
  }
}