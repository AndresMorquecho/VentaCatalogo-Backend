
import { Request, Response } from 'express';
import { RegisterOrderPaymentUseCase } from '../application/RegisterOrderPayment.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';
import { AuthRequest } from '../../../middleware/auth';

export class PaymentController {
    constructor(private registerOrderPaymentUseCase: RegisterOrderPaymentUseCase) { }

    registerPayment = async (req: AuthRequest, res: Response) => {
        try {
            const orderId = req.body.order_id || req.body.orderId;
            const amount = req.body.amount;
            const creditAmount = req.body.credit_amount ?? req.body.creditAmount ?? 0;
            const method = req.body.method;
            const referenceNumber = req.body.reference_number || req.body.referenceNumber;
            const bankAccountId = req.body.bank_account_id || req.body.bankAccountId;
            const notes = req.body.notes;

            if (!orderId || (amount === undefined && creditAmount === undefined)) {
                return HttpResponse.badRequest(res, 'Missing required fields: orderId and amount (or creditAmount) are required.');
            }

            console.log("PAYMENT REQ BODY:", req.body);

            if (Number(amount) > 0 && (!method || !bankAccountId)) {
                return HttpResponse.badRequest(res, 'Missing required fields: method and bankAccountId are required for manual payments.');
            }

            const dto = {
                orderId,
                amount: Number(amount) || 0,
                method: method || 'EFECTIVO',
                referenceNumber,
                bankAccountId,
                notes,
                creditAmount: Number(creditAmount)
            };

            const result = await this.registerOrderPaymentUseCase.execute(dto, req.user!.email);

            if (result.isFailure) {
                console.error('[PaymentController] Registration failure:', result.error);
                return HttpResponse.fail(res, result.error!);
            }

            return HttpResponse.created(res, result.getValue());
        } catch (error) {
            console.error('[PaymentController] Unexpected error during payment registration:', error);
            return HttpResponse.fail(res, error instanceof Error ? error.message : 'An unexpected error occurred during payment registration.');
        }
    };
}
