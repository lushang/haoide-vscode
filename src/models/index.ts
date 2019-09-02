import { 
    MetaObject, MetadataModel, 
    FileAttributes, 
    RetrieveResult, FileProperty, Message,
    DeployResult, DeployResultDetails, 
    ComponentSuccess, RunTestResult
} from "./meta";
import { Session } from "./session";
import { DescribeSObjectResult, SObjectDesc, Field } from "./sobject";
import { TestObject, TestSuite, TestResponse } from "./test";

// Template for creating meta object
export interface Template {
    type: string;
    directory: string;
    extension: string;
    children: Template[];
}

export {
    MetaObject, MetadataModel,
    FileAttributes,
    RetrieveResult, FileProperty, Message,
    DeployResult, DeployResultDetails, 
    ComponentSuccess, RunTestResult,
    Session,
    DescribeSObjectResult, SObjectDesc, Field,
    TestObject, TestSuite, TestResponse
};