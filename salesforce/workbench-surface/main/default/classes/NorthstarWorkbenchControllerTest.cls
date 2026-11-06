@IsTest
private class NorthstarWorkbenchControllerTest {
    private class WorkerMock implements HttpCalloutMock {
        Integer status;
        String body;
        HttpRequest received;
        WorkerMock(Integer status, String body) {
            this.status = status;
            this.body = body;
        }
        public HttpResponse respond(HttpRequest request) {
            received = request;
            HttpResponse response = new HttpResponse();
            response.setStatusCode(status);
            response.setBody(body);
            return response;
        }
    }

    private class FailingMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest request) {
            throw new CalloutException('down');
        }
    }

    @IsTest
    static void presentsTheAccessTokenOnAReadOperation() {
        WorkerMock worker = new WorkerMock(200, '{"active":false}');
        Test.setMock(HttpCalloutMock.class, worker);
        Test.startTest();
        NorthstarWorkbenchController.Result result = NorthstarWorkbenchController.call('progress', 'token', null);
        Test.stopTest();
        System.assertEquals(200, result.status);
        System.assertEquals('{"active":false}', result.body);
        System.assertEquals('GET', worker.received.getMethod());
        System.assertEquals('token', worker.received.getHeader('cf-access-token'));
        System.assertEquals(NorthstarWorkbenchController.WORKER_URL + '/agent/surface/turn', worker.received.getEndpoint());
    }

    @IsTest
    static void sendsTheBodyOfAWriteOperation() {
        WorkerMock worker = new WorkerMock(202, '{"turnId":"1"}');
        Test.setMock(HttpCalloutMock.class, worker);
        Test.startTest();
        NorthstarWorkbenchController.Result result = NorthstarWorkbenchController.call('startTurn', 'token', '{"text":"Hi"}');
        Test.stopTest();
        System.assertEquals(202, result.status);
        System.assertEquals('POST', worker.received.getMethod());
        System.assertEquals('{"text":"Hi"}', worker.received.getBody());
    }

    @IsTest
    static void sendsAnEmptyObjectWhenAWriteHasNoBody() {
        WorkerMock worker = new WorkerMock(200, '{}');
        Test.setMock(HttpCalloutMock.class, worker);
        Test.startTest();
        NorthstarWorkbenchController.call('confirmWrite', 'token', null);
        Test.stopTest();
        System.assertEquals('{}', worker.received.getBody());
    }

    @IsTest
    static void treatsAnAccessRedirectAsSignedOut() {
        Test.setMock(HttpCalloutMock.class, new WorkerMock(302, ''));
        Test.startTest();
        NorthstarWorkbenchController.Result result = NorthstarWorkbenchController.call('bootstrap', 'expired', null);
        Test.stopTest();
        System.assertEquals(401, result.status);
    }

    @IsTest
    static void makesNoCalloutWithoutAToken() {
        NorthstarWorkbenchController.Result result = NorthstarWorkbenchController.call('bootstrap', ' ', null);
        System.assertEquals(401, result.status);
        System.assertEquals(0, Limits.getCallouts());
    }

    @IsTest
    static void refusesAnOperationItDoesNotName() {
        Boolean refused = false;
        try {
            NorthstarWorkbenchController.call('/agent/audit/export', 'token', null);
        } catch (AuraHandledException expected) {
            refused = true;
        }
        System.assert(refused, 'Only named operations can be reached.');
        System.assertEquals(0, Limits.getCallouts());
    }

    @IsTest
    static void reportsAnUnreachableWorkerWithoutItsDetail() {
        Test.setMock(HttpCalloutMock.class, new FailingMock());
        Boolean failed = false;
        Test.startTest();
        try {
            NorthstarWorkbenchController.call('bootstrap', 'token', null);
        } catch (AuraHandledException expected) {
            failed = true;
        }
        Test.stopTest();
        System.assert(failed, 'A failed callout should surface as a handled error.');
    }
}
