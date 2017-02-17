'use strict';


const uuid = require('uuid');
const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const process = require('process');

function checkExistanceOfInvoice(invoiceid, resultCB) {
  const queryforexistance = {
     TableName: "Invoices",
     FilterExpression: 'invoiceid = :invoiceid',
     ExpressionAttributeValues: {':invoiceid': invoiceid}
  };

  dynamoDb.scan(queryforexistance, function(err, cb) {
    if (!err) {
      resultCB({message: "Done", result: cb.Items});
    } else {
      resultCB({message: "Error", error: err});
    }
  });
}

function setInvoiceIdStatus(invoiceid, status, resultCB) {
  const updateInvoiceStatusQuery = {
    TableName: "Invoices",
    Key: {
      identifier: invoiceid
    },
    ExpressionAttributeNames: {
      '#invoicestatus': 'invoicestatus',
    },
    ExpressionAttributeValues: {
      ':invoicestatus': status
    },
    UpdateExpression: 'SET #invoicestatus = :invoicestatus',
    ReturnValues: 'ALL_NEW',
  };
  dynamoDb.update(updateInvoiceStatusQuery, function(updatedbError, updatedbResult) {
    if (!updatedbError) {
      resultCB({message: "Done", result: updatedbResult});
    } else {
      resultCB({message: "Error", error: updatedbError});
    }
  });
}
module.exports.receivepayment = (event, context, callback) => {
  const requestHeaders = event.headers;  const httpMethod = event.httpMethod;

  var responseBody = {
    statusCode: 400,
    message: "Invalid Response"
  };
  var response = {
    statusCode: responseBody.statusCode,
    body: responseBody
  };
  const postBody = JSON.parse(event.body);
  if (postBody["id"] !== undefined) {
    const timestamp = new Date().getTime();
    var dbrecord = {
      identifier: uuid.v1(),
      createdAt: timestamp
    };
    // Get ready to inter in DB
    const dbparams = {
        TableName: "Events",
        Item: dbrecord
    };
    if (postBody["id"].toString().indexOf("evt") >= 0) {
      dbrecord["eventType"] = "stripe";
    }
    if (postBody["id"] !== undefined) dbrecord["id"] = postBody["id"];
    if (postBody.livemode !== undefined) dbrecord.live = postBody.livemode;
    if (postBody["created"] !== undefined) dbrecord["created"] = postBody["created"];
    if (postBody["api_version"] !== undefined) dbrecord["api_version"] = postBody["api_version"];
    if (postBody["type"] !== undefined) {
        dbrecord["stripe_tx_type"] = postBody["type"];
        console.log("Charge type: " + dbrecord["stripe_tx_type"]);
    }
    // BEGIN: GET INVOICE ID
    if (postBody["data"] !== undefined) {
      if (postBody["data"] !== null) {
        if (postBody["data"]["object"] !== undefined) {
          if (postBody["data"]["object"] !== null) {
            if (postBody.data.object["id"] !== undefined) dbrecord["stripe_charge_id"] = postBody.data.object["id"];
            if (postBody.data.object.amount !== undefined) dbrecord.invoiceamount = postBody.data.object.amount;
            if (postBody.data.object["amount_refunded"] !== undefined) dbrecord.amountrefunded = postBody.data.object["amount_refunded"];
            if (postBody.data.object.currency !== undefined) dbrecord.postBody = postBody.data.object.currency;
            if (postBody.data.object.metadata !== undefined) {
              if (postBody.data.object.metadata.invoiceid !== undefined) dbrecord.invoiceid = postBody.data.object.metadata.invoiceid;
              if (postBody.data.object.metadata['description'] !== undefined) dbrecord.invoicedescription = postBody.data.object.metadata['description'];
            }
            if (postBody.data.object.captured !== undefined) dbrecord.captured = postBody.data.object.captured;
            if (postBody.data.object.refunded !== undefined) dbrecord.refunded = postBody.data.object.refunded;
          }
        }
      }
    }
    // END: GET INVOICE ID

    // Transaction types:

    // After payment: charge.succeeded do the following
    if (dbrecord["stripe_tx_type"] == "charge.succeeded" || dbrecord["stripe_tx_type"] == "charge.captured" || dbrecord["stripe_tx_type"] == "charge.refunded") {
      if (dbrecord.invoiceid !== undefined) {
        checkExistanceOfInvoice(dbrecord.invoiceid, function(cb) {
          if (cb.message == "Done") {
            if (cb.result !== undefined) {
              if (cb.result !== null) {
                // Must be 1
                if (cb.result.length == 1) {
                  if (cb.result[0]["identifier"] !== undefined) {
                    console.log("Identifier found: " + cb.result[0]["identifier"]);
                    var invoice_status = "No Status";
                    if (dbrecord.captured == false) {
                      if (dbrecord.refunded == true) {
                        invoice_status = "Refunded";
                      } else {
                        invoice_status = "Authorized - Pending";
                      }
                    } else {
                      // if captured is true (Maybe lets handle a part payment)
                      invoice_status = "Paid";
                      if (parseInt(dbrecord.amountrefunded) > 0) {
                        if (parseInt(dbrecord.invoiceamount) == parseInt(dbrecord.amountrefunded)) {
                          console.log("FULL refund detected!");
                          invoice_status = "Refunded";
                        } else {
                          console.log("Part payment detected!");
                          invoice_status = "Part Settled";
                        }
                      }
                    }
                    console.log("Setting status to: " + invoice_status);
                    setInvoiceIdStatus(cb.result[0]["identifier"], invoice_status, function(cb) {
                      if (cb.message == "Done") {
                        console.log("Updated");
                      } else {
                        console.log("Error: Not updated. " + JSON.stringify(cb.error));
                      }
                    });
                  }
                }
              }
            }
          } else {
            console.log("Error trying to search for invoice " + cb.error);
          }
        });
      }
    }
    // When refunded: charge.refunded do the following

    responseBody['statusCode'] = 200;
    responseBody['message'] = "Done";
    responseBody['debug'] = dbrecord;
    response['body'] = JSON.stringify(responseBody);
    response['statusCode'] = responseBody.statusCode;
    callback(null, response);
  } else {
    callback(null, response);
  }
}
